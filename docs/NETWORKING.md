# 네트워크, 도메인, 터널링

이 문서는 로컬 개발부터 외부 공개까지 STAR의 모든 네트워크 경로를 설명합니다.

## 1. 서비스와 포트

| 구성요소 | 내부 포트 | 로컬 개발 | 인터넷 공개 |
|---|---:|---|---|
| Next.js 웹 | 3000 | `localhost:3000` | Caddy 뒤에서만 공개 |
| FastAPI | 8000 | `localhost:8000` | `/api/*`로만 공개 |
| PostgreSQL | 5432 | 개발 PC에서만 | 공개 금지 |
| Qdrant HTTP | 6333 | 필요 시 로컬 | 공개 금지 |
| Qdrant gRPC | 6334 | 필요 시 로컬 | 공개 금지 |
| Gemma vLLM | 호스트 7510 → 컨테이너 8000 | 신뢰 네트워크 | 공개 금지 |
| BGE-M3 vLLM | 컨테이너 8000 | API 내부 호출 | 공개 금지 |
| whisper.cpp | 컨테이너 8080 | API 내부 호출 | 공개 금지 |
| Caddy 터널 입구 | 호스트 8081 → 컨테이너 80 | `127.0.0.1` 전용 | Funnel/Tunnel이 전달 |

생성 모델, DB, Qdrant, Whisper는 절대로 공유기 포트포워딩이나 공인 인터페이스에 직접 노출하지 않습니다.

## 2. 요청 흐름

```text
브라우저
  → HTTPS 공개 주소
  → Tailscale Funnel 또는 Cloudflare Tunnel
  → 127.0.0.1:8081
  → Caddy
      ├─ /api/* → FastAPI:8000
      └─ 나머지 → Next.js:3000

FastAPI
  ├─ PostgreSQL:5432
  ├─ Qdrant:6333
  ├─ BGE-M3:8000
  ├─ Whisper:8080
  └─ host.docker.internal:7510 → Gemma vLLM
```

`compose.production.yml`의 `internal` 네트워크는 DB와 Qdrant를 외부에서 격리합니다. `edge`는 Caddy, 웹, API와 외부 다운로드가 필요한 모델 서비스가 사용합니다.

## 3. 로컬 개발

로컬에서는 터널 없이 다음 주소를 사용합니다.

```text
웹      http://localhost:3000
API     http://localhost:8000/api/v1
문서    http://localhost:8000/docs
DB      localhost:5432
```

웹의 `NEXT_PUBLIC_API_URL`은 `http://localhost:8000/api/v1`, API의 CORS는 `http://localhost:3000`을 허용합니다.

## 4. Tailscale Funnel

Tailscale Funnel은 개발·제한 테스트용입니다. `*.ts.net` 주소만 사용할 수 있고 베타이며 대역폭 제한을 직접 조정할 수 없습니다.

### Linux 또는 DGX Spark

```bash
sudo tailscale up
tailscale status
tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'
```

현재 사용자가 `sudo` 없이 Funnel을 갱신하게 하려면 한 번만 설정합니다.

```bash
sudo tailscale set --operator="$USER"
```

`.env.production`을 만들고 `DOMAIN`에는 프로토콜과 마지막 슬래시 없이 장비의 Tailscale DNS 이름을 넣습니다.

```dotenv
DOMAIN=device-name.tailnet-name.ts.net
```

배포합니다.

```bash
./scripts/deploy-tailscale.sh
```

스크립트는 Caddy를 `127.0.0.1:8081`에만 열고 다음 명령과 같은 Funnel을 구성합니다.

```bash
tailscale funnel --bg http://127.0.0.1:8081
tailscale funnel status
```

### macOS

1. Tailscale 공식 Standalone 또는 Mac App Store 앱을 설치합니다.
2. 시스템 설정에서 VPN 구성을 허용합니다.
3. 개인 tailnet 계정으로 로그인합니다.
4. 터미널에서 `tailscale status`를 확인합니다.
5. 위와 동일하게 Funnel을 `127.0.0.1:8081`로 연결합니다.

macOS용 Tailscale 변형에 따라 Funnel의 파일 공유 기능에는 차이가 있지만 STAR는 포트 프록시만 사용합니다.

### Funnel 장애 점검

```bash
curl -fsS http://127.0.0.1:8081/api/v1/health
tailscale status
tailscale funnel status
curl -fsS https://<DOMAIN>/api/v1/health
```

로컬 `8081`은 정상인데 공개 주소만 실패하면 Tailscale 상태를 재수립합니다.

```bash
sudo tailscale down
sudo tailscale up
tailscale funnel --bg http://127.0.0.1:8081
```

이 작업은 해당 장비의 Tailscale 연결을 잠시 끊으므로 원격 SSH 세션 하나만 의존하는 상황에서는 현장 접근 수단을 먼저 확보합니다.

## 5. Cloudflare Tunnel

정식 도메인을 확보한 뒤 외부 베타에 적합합니다. 공유기 80/443 포트포워딩 없이 outbound tunnel로 Caddy에 연결합니다.

1. 개인 Cloudflare 계정에 도메인을 추가합니다.
2. Zero Trust에서 Tunnel을 생성합니다.
3. 공개 hostname 예: `app.example.com`을 생성합니다.
4. 서비스 대상은 `http://caddy:80`으로 설정합니다.
5. 발급된 tunnel token을 `.env.production`의 `CLOUDFLARE_TUNNEL_TOKEN`에 넣습니다.
6. `DOMAIN=app.example.com`으로 설정합니다.
7. 배포합니다.

```bash
./scripts/deploy-cloudflare.sh
```

`compose.cloudflare.yml`은 호스트 포트를 열지 않고 `cloudflared`와 Caddy가 Docker `edge` 네트워크에서 통신하게 합니다.

토큰은 비밀번호와 동일하게 취급하고 Git, 문서, 터미널 캡처에 남기지 않습니다.

## 6. OAuth Redirect URI

OAuth 공급자에 등록한 URI는 문자 단위로 정확히 일치해야 합니다.

### 로컬

```text
http://localhost:8000/api/v1/auth/oauth/kakao/callback
```

### 운영

```text
https://<DOMAIN>/api/v1/auth/oauth/kakao/callback
```

Spark에서 Mac으로 이동하면 Tailscale 장비 주소도 바뀝니다. 다음 네 곳을 함께 바꿉니다.

1. `.env.production`의 `DOMAIN`
2. Kakao 개발자 콘솔 Redirect URI
3. API의 `FRONTEND_URL`과 CORS — Compose에서는 `DOMAIN`에서 자동 생성
4. 실제 공개 주소를 사용하는 모바일 앱과 문서

## 7. `host.docker.internal`

Gemma가 호스트에서, FastAPI가 Docker 컨테이너에서 실행될 때 컨테이너는 `localhost:7510`으로 호스트에 갈 수 없습니다.

```dotenv
CHAT_API_BASE_URL=http://host.docker.internal:7510
```

Linux에서는 Compose의 다음 설정이 필요합니다.

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Mac과 Windows Docker Desktop은 이 이름을 기본 지원하지만 같은 설정을 유지해도 됩니다.

## 8. 방화벽 원칙

- 공개 허용: 터널이 제공하는 HTTPS 진입점만
- localhost 한정: Caddy `8081`, 개발 서버
- 사설망 한정: 필요할 때의 SSH 22
- 공개 금지: 5432, 6333, 6334, 7510, 내부 8000, Whisper 8080
- SSH는 비밀번호 대신 키 인증 사용
- API 키가 없는 vLLM을 인터넷에 직접 공개하지 않음

## 9. Mac 운영 주의사항

- Mac이 잠들면 API도 중단됩니다.
- Docker Desktop 자동 시작과 컨테이너 `restart: unless-stopped`를 확인합니다.
- 장시간 공개 서비스는 Mac보다 소형 VPS 게이트웨이와 개인 Mac 모델 서버의 분리를 고려합니다.
- 외부 서비스 전환 전 DB와 업로드 백업을 먼저 생성합니다.

## 10. 공식 참고자료

- Tailscale Funnel: <https://tailscale.com/docs/features/tailscale-funnel>
- Tailscale macOS: <https://tailscale.com/docs/install/mac>
- Cloudflare Tunnel: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/>
- Docker 네트워크: <https://docs.docker.com/engine/network/>
