# DGX Spark에서 Mac으로 이전

목표는 Spark를 끈 뒤에도 코드, 대화 DB, 프로젝트 계층, 첨부파일, 검색 인덱스와 설정을 Mac에서 재현하는 것입니다. Git 저장소와 실데이터 백업은 분리합니다.

## 1. Git으로 옮기는 것

- 전체 애플리케이션 소스
- Alembic 마이그레이션
- 디자인 이미지와 QA 캡처
- Docker/Caddy/터널 설정
- 예제 환경변수와 문서
- 모델 ID, 실행 옵션, 설치 위치

## 2. Git으로 옮기지 않는 것

- 운영 `.env.production`
- DB 덤프와 Docker 볼륨 원본
- 사용자 업로드
- OAuth/API/JWT 비밀값
- Hugging Face 모델 캐시

이 항목은 암호화된 외장 저장소 또는 개인 보안 저장소로 별도 이동합니다.

## 3. Spark에서 최종 상태 기록

```bash
cd ~/brown-chat
date -Is
docker compose --env-file .env.production \
  -f compose.production.yml \
  -f compose.tailscale.yml ps
docker image ls
docker volume ls
tailscale status
tailscale funnel status
```

명령 출력에는 공개 가능한 구성만 남기고 token과 secret은 문서에 복사하지 않습니다.

## 4. 휴대 가능한 백업 생성

저장소에 포함된 스크립트를 Spark에서 실행합니다.

```bash
cd ~/brown-chat
chmod +x scripts/export-portable-backup.sh
./scripts/export-portable-backup.sh .env.production
```

생성 위치는 `backups/portable-<timestamp>/`입니다.

```text
portable-<timestamp>/
├── postgres.sql.gz
├── qdrant-volume.tar.gz
├── uploads-volume.tar.gz
├── manifest.txt
└── SHA256SUMS
```

이 백업은 대화·사용자·업로드가 들어 있는 민감한 운영 데이터입니다. Git 저장소에 넣지 말고, 복사 전에 FileVault가 켜진 Mac 또는 암호화된 외장 SSD인지 확인합니다. 클라우드에 올릴 때는 압축 파일 자체를 별도로 암호화합니다.

모델 가중치와 Whisper 캐시는 다시 받을 수 있으므로 기본 백업에서 제외합니다. 직접 만든 LoRA 어댑터나 다시 생성할 수 없는 평가셋은 별도 `adapters/`, `evals/` 폴더에 복사합니다.

## 5. PC로 복사

Windows PowerShell 예시:

```powershell
scp -i "$env:USERPROFILE\.ssh\id_ed25519_spark_persistent" -r `
  ai-010@172.16.0.220:/home/ai-010/brown-chat/backups/portable-YYYYMMDD-HHMMSS `
  "$env:USERPROFILE\STAR-backups\"
```

Mac 예시:

```bash
mkdir -p ~/STAR-backups
scp -i ~/.ssh/id_ed25519_spark_persistent -r \
  ai-010@172.16.0.220:/home/ai-010/brown-chat/backups/portable-YYYYMMDD-HHMMSS \
  ~/STAR-backups/
```

복사한 뒤 체크섬을 확인합니다.

```bash
cd ~/STAR-backups/portable-YYYYMMDD-HHMMSS
shasum -a 256 -c SHA256SUMS
```

Linux에서는 `sha256sum -c SHA256SUMS`를 사용합니다.

백업은 최소 두 곳에 둡니다.

1. 개인 Mac 또는 현재 Windows PC
2. 암호화된 외장 SSD 또는 개인 클라우드

## 6. Mac에 코드 설치

[`SETUP_MACOS.md`](SETUP_MACOS.md)를 완료한 뒤 private Git 저장소를 clone합니다.

```bash
cd ~/workspace/star
cp .env.production.example .env.production
```

Spark의 `.env.production`을 그대로 Git으로 옮기지 않습니다. 개인 Mac에서 DB 비밀번호, JWT, OAuth secret을 다시 입력합니다. API 제공자의 개인 계정으로 발급된 키만 사용합니다.

## 7. 새 빈 볼륨 생성

```bash
docker compose --env-file .env.production \
  -f compose.production.yml \
  -f compose.tailscale.yml up -d postgres qdrant
```

복원 전에 새 DB가 비어 있고 대상 백업이 정확한지 다시 확인합니다.

## 8. PostgreSQL 복원

기존 데이터가 없는 새 볼륨에서 실행합니다.

```bash
gunzip -c ~/STAR-backups/portable-YYYYMMDD-HHMMSS/postgres.sql.gz | \
  docker compose --env-file .env.production \
    -f compose.production.yml \
    exec -T postgres psql -U brown_chat -d brown_chat
```

그다음 최신 스키마를 적용합니다.

```bash
docker compose --env-file .env.production \
  -f compose.production.yml run --rm api alembic upgrade head
```

## 9. 업로드와 Qdrant 복원

`export-portable-backup.sh`의 `manifest.txt`에는 원본 Docker volume 이름이 기록됩니다. Mac의 새 volume 이름은 다음 명령으로 확인합니다.

```bash
docker volume ls --filter label=com.docker.compose.project=brown-chat
```

대상 볼륨이 비어 있을 때만 임시 Alpine 컨테이너로 압축을 풉니다.

```bash
docker run --rm \
  -v <MAC_QDRANT_VOLUME>:/restore \
  -v ~/STAR-backups/portable-YYYYMMDD-HHMMSS:/backup:ro \
  alpine:3.20 sh -c 'cd /restore && tar -xzf /backup/qdrant-volume.tar.gz'

docker run --rm \
  -v <MAC_UPLOADS_VOLUME>:/restore \
  -v ~/STAR-backups/portable-YYYYMMDD-HHMMSS:/backup:ro \
  alpine:3.20 sh -c 'cd /restore && tar -xzf /backup/uploads-volume.tar.gz'
```

기존 데이터가 있는 볼륨에 덮어풀지 않습니다. 잘못된 대상이면 새 볼륨을 만들어 다시 복원합니다.

Qdrant 복원이 어렵거나 임베딩 모델을 바꾼 경우 PostgreSQL을 원본으로 벡터를 재생성할 수 있습니다.

```bash
docker compose --env-file .env.production \
  -f compose.production.yml \
  exec -T api python -m app.scripts.backfill_chat_memory
```

## 10. 모델 재설치

모델 캐시를 복사하지 않고 [`../models/README.md`](../models/README.md)에 따라 Mac용 모델을 다시 받습니다. Gemma의 NVIDIA vLLM 설정을 Mac에서 그대로 실행하지 않습니다.

## 11. 네트워크 전환

1. Mac Tailscale 설치·로그인
2. 새 `*.ts.net` DNS 이름 확인
3. `.env.production`의 `DOMAIN` 변경
4. Kakao Redirect URI 변경
5. Funnel 또는 Cloudflare Tunnel 재구성
6. 공개 상태 확인

```bash
curl -fsS http://127.0.0.1:8081/api/v1/health
curl -fsS https://<NEW_DOMAIN>/api/v1/health
```

## 12. 복원 완료 기준

- 회원가입 또는 마스터키 입장 성공
- 기존 프로젝트와 대화 표시
- 기존 첨부파일 열림
- 텍스트 채팅과 스트리밍 성공
- 이미지 질문 성공 또는 명시된 대체 모델 동작
- 음성 전사 성공
- 새 대화가 PostgreSQL에 저장됨
- Qdrant 검색 또는 최근 대화 fallback 동작
- 모바일과 외부 네트워크에서 HTTPS 접속 성공

복원 검증 전에는 Spark 원본과 최종 백업을 삭제하지 않습니다.
