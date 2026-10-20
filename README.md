# STAR

STAR는 이미지·음성·파일을 이해하고 대화를 프로젝트 단위로 정리하는 패션 에이전트입니다. 이 저장소는 기존 Brown-Chat에서 발전한 전체 소스, 데이터베이스 마이그레이션, 배포 설정, 디자인 원본과 의사결정 기록을 보존합니다. 내부 Docker 리소스와 일부 패키지 이름은 기존 배포 호환성을 위해 `brown-chat`을 유지합니다.

## 현재 구성

- `apps/api`: FastAPI, PostgreSQL, Qdrant, 첨부파일, 스트리밍, STT 연동
- `apps/web`: Next.js App Router 기반 STAR 랜딩과 채팅 UI
- `deploy`: DGX Spark의 vLLM 모델 서버 설정
- `models`: Git에 포함하지 않는 모델별 설치 위치와 재설치 안내
- `runtime`: DB·벡터·업로드·백업의 복원 경로를 보존하는 빈 구조
- `docs`: Windows, macOS, 네트워크, 디자인, 이관, Git 작업 문서
- `scripts`: 배포, DB 백업, Spark 이관용 스크립트

상세 트리는 [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md)를 참고합니다.

## 처음 설치할 때

- Windows + WSL2: [`docs/SETUP_WINDOWS.md`](docs/SETUP_WINDOWS.md)
- Apple Silicon Mac: [`docs/SETUP_MACOS.md`](docs/SETUP_MACOS.md)
- 포트·Tailscale·Cloudflare·OAuth: [`docs/NETWORKING.md`](docs/NETWORKING.md)
- Spark에서 Mac으로 이전: [`docs/MIGRATION_SPARK_TO_MAC.md`](docs/MIGRATION_SPARK_TO_MAC.md)
- 모델 설치 위치와 역할: [`models/README.md`](models/README.md)
- 디자인 원칙과 원본 목록: [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md)
- Git/GitHub 작업 방식: [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md)
- 현재 테스트와 이관 전 검증 기록: [`docs/VERIFICATION.md`](docs/VERIFICATION.md)

## 로컬 개발 빠른 시작

필수 프로그램은 Docker, Git, Node.js 22, Python 3.12를 관리하는 `uv`입니다. 운영 비밀값은 커밋하지 않습니다.

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
docker compose up -d postgres

cd apps/api
uv sync --dev
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

별도 터미널에서 웹을 실행합니다.

```bash
cd apps/web
npm ci
npm run dev
```

- 웹: <http://localhost:3000>
- API: <http://localhost:8000>
- API 문서: <http://localhost:8000/docs>

LLM, 임베딩, Whisper 주소는 `apps/api/.env`에서 지정합니다. 가중치는 저장소에 포함되지 않으며 [`models/README.md`](models/README.md)의 지시에 따라 설치합니다.

## 운영 구성

운영 Compose는 Next.js, FastAPI, PostgreSQL 16, Qdrant, BGE-M3, whisper.cpp, Caddy를 실행합니다. 생성 모델 Gemma는 별도 OpenAI 호환 vLLM 서버로 동작합니다.

```bash
cp .env.production.example .env.production
./scripts/deploy-tailscale.sh
```

기존 DGX Spark 배포 절차는 [`DEPLOYMENT.md`](DEPLOYMENT.md)에 보존되어 있습니다. 새 Mac 또는 서버를 공개할 때는 [`docs/NETWORKING.md`](docs/NETWORKING.md)를 먼저 읽습니다.

## 저장소에 포함되는 것

- 애플리케이션 전체 소스와 테스트
- Alembic DB 스키마 이력
- Docker, Caddy, Tailscale, Cloudflare 설정
- STAR 및 과거 Brown-Chat 디자인 원본
- 디자인 QA 캡처와 구현 기록
- 모델과 런타임 데이터의 폴더 구조 및 설치 문서
- 제품 정책과 결정 이력 `devel-QA.md`

## 저장소에 포함되지 않는 것

- `.env`, API 키, OAuth secret, JWT secret, 비밀번호
- PostgreSQL 실데이터와 Qdrant 실인덱스
- 사용자 대화, 업로드 이미지, 음성 파일
- Gemma/BGE-M3/Whisper 가중치와 Hugging Face 캐시
- `node_modules`, `.next`, `.venv`, 테스트·빌드 캐시

이 항목들은 `scripts/export-portable-backup.sh`로 별도 암호화 보관하고 Git에는 올리지 않습니다.

## 검증

```bash
cd apps/api && uv run pytest
cd apps/web && npm run lint && npm run build
```

제품 요구사항과 미결정 사항은 [`devel-QA.md`](devel-QA.md)에 누적하며 기존 이력을 삭제하지 않습니다.
