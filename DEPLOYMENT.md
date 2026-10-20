# Brown-Chat 운영 배포

> 이 문서는 기존 DGX Spark 배포 이력을 보존합니다. 새 Windows 설치는 `docs/SETUP_WINDOWS.md`, Apple Silicon Mac 이전은 `docs/SETUP_MACOS.md`, Tailscale·Cloudflare·포트·OAuth 전체 설명은 `docs/NETWORKING.md`, Spark 실데이터 이관은 `docs/MIGRATION_SPARK_TO_MAC.md`를 우선 참고합니다. 사용자 화면의 현재 브랜드명은 STAR이며 내부 `brown-chat` 리소스명은 호환성을 위해 유지합니다.

이 구성은 DGX Spark에서 Next.js, FastAPI, PostgreSQL, Qdrant, BGE-M3 임베딩 서버, Caddy를 Docker Compose로 운영하고, Tailscale Funnel을 통해 무료 고정 `*.ts.net` 주소로 외부에 HTTPS 공개하는 구조입니다. 공유기 포트 포워딩은 필요하지 않습니다.

Spark의 `8080` 포트는 기존 Airflow가 사용하므로 Brown-Chat Caddy는 외부에 공개되지 않는 `127.0.0.1:8081`만 사용합니다.

## 1. 서버 준비

- DGX Spark에는 이미 Docker Engine과 Docker Compose가 준비되어 있어야 합니다.
- DGX Spark에 Tailscale을 설치하고 로그인해야 합니다.
- Tailscale Funnel을 사용하므로 공유기나 DGX Spark 방화벽에서 80/443을 열지 않습니다.
- PostgreSQL 5432, Qdrant 6333/6334, FastAPI 8000, Next.js 3000, 생성용 vLLM 7510과 임베딩용 vLLM은 외부에 공개하지 않습니다.
- DGX Spark에서 `http://127.0.0.1:7510/v1/models`가 응답하는지 확인합니다.

Tailscale 설치 후 다음 명령으로 로그인하고 장비의 고정 주소를 확인합니다.

```bash
sudo tailscale up
tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'
```

## 2. 환경변수

```bash
cp .env.production.example .env.production
```

`.env.production`의 실제 값은 Git에 커밋하지 않습니다. `DOMAIN`에는 프로토콜 없이 호스트 이름만 입력합니다. `DATABASE_URL`의 비밀번호에 특수문자가 있으면 URL 인코딩해야 합니다.

위 명령에서 확인한 `*.ts.net` 주소를 `.env.production`의 `DOMAIN`에 입력합니다. Tailscale 계정이나 인증 정보를 `.env.production`, Git 또는 `devel-QA.md`에 기록하지 않습니다.

최초 배포에서는 다음 스크립트로 운영 DB 및 JWT 비밀값을 Spark에서 새로 생성합니다. 이 스크립트는 기존 `.env.production`을 덮어쓰지 않습니다. 두 번째 인자를 생략하면 카카오 키는 빈 값으로 생성되며 이후 별도로 입력할 수 있습니다.

```bash
./scripts/create-production-env.sh <TAILSCALE_DOMAIN>
```

운영 환경에서는 카카오 개발자 콘솔 Redirect URI에 다음 주소를 추가합니다.

```text
https://<DOMAIN>/api/v1/auth/oauth/kakao/callback
```

## 3. 첫 배포와 업데이트

```bash
chmod +x scripts/deploy-tailscale.sh scripts/backup-db.sh
./scripts/deploy-tailscale.sh
```

FastAPI 컨테이너가 시작될 때 `alembic upgrade head`를 먼저 실행합니다. 이후 업데이트는 코드를 받은 다음 같은 배포 명령을 다시 실행하면 됩니다.

기존 PostgreSQL 대화를 처음 Qdrant에 반영하거나 임베딩 모델을 교체한 뒤
벡터를 다시 만들 때는 다음 명령을 실행합니다. 같은 질문 ID로 upsert하므로
반복 실행해도 중복 벡터가 생기지 않습니다.

```bash
docker compose --env-file .env.production \
  -f compose.production.yml \
  -f compose.tailscale.yml \
  exec -T api python -m app.scripts.backfill_chat_memory
```

```bash
git pull --ff-only
./scripts/backup-db.sh
./scripts/deploy-tailscale.sh
```

## 4. 상태 확인

```bash
docker compose --env-file .env.production -f compose.production.yml -f compose.tailscale.yml ps
docker compose --env-file .env.production -f compose.production.yml -f compose.tailscale.yml logs --tail=200 api embedding qdrant web caddy
tailscale funnel status
curl -fsS https://<TAILSCALE_DOMAIN>/api/v1/health
```

## 5. 롤백

운영 배포 전 Git 커밋 또는 릴리스 태그를 남깁니다. 문제가 생기면 이전 태그를 체크아웃하고 `./scripts/deploy-tailscale.sh`를 다시 실행합니다. DB 마이그레이션이 포함된 배포는 먼저 백업을 복원할지 판단해야 합니다.

## 보안 원칙

- vLLM `7510` 포트를 공용 인터넷에 직접 공개하지 않습니다.
- Tailscale 계정 인증 정보를 Git이나 문서에 기록하지 않습니다.
- `.env.production`과 `backups/`를 Git에 올리지 않습니다.
- 운영 PostgreSQL은 외부 포트를 열지 않습니다.
- 운영 Qdrant와 임베딩 API는 외부 포트를 열지 않습니다.
- 서버 SSH는 키 인증을 사용하고 비밀번호 로그인을 끕니다.
- 운영 비밀값은 충분히 긴 임의값으로 생성합니다.
