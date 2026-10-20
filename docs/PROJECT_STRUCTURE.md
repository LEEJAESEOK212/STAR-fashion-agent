# 프로젝트 구조

이 문서는 STAR를 새 Windows 또는 Mac에 복원할 때 각 폴더의 책임과 보존 여부를 설명합니다.

```text
llm-service/
├── apps/
│   ├── api/                    FastAPI 백엔드
│   │   ├── app/
│   │   │   ├── api/routes/     인증·채팅·상태 API
│   │   │   ├── core/           환경설정·보안
│   │   │   ├── db/             SQLAlchemy 연결
│   │   │   ├── models/         DB 모델
│   │   │   ├── schemas/        요청·응답 스키마
│   │   │   ├── scripts/        채팅 메모리 백필
│   │   │   └── services/       첨부·LLM·메모리·전사
│   │   ├── migrations/         Alembic 스키마 이력
│   │   └── tests/              API 자동 테스트
│   └── web/                    Next.js 프론트엔드
│       ├── app/                랜딩·로그인·채팅 UI
│       ├── lib/                API 클라이언트
│       ├── public/             STAR/Brown-Chat 디자인 원본
│       └── design-qa*.png      디자인 비교·검증 캡처
├── deploy/
│   └── vllm-compose.yml        DGX Spark Gemma 서버 설정
├── docs/                       설치·운영·디자인·이관 문서
├── models/                     가중치 제외, 설치 설명만 추적
│   ├── gemma-4-26b-a4b-it/
│   ├── bge-m3/
│   └── whisper-small/
├── runtime/                    실데이터 제외, 복원 위치만 추적
│   ├── postgres/
│   ├── qdrant/
│   ├── uploads/
│   ├── backups/
│   └── huggingface/
├── scripts/                    배포·백업·운영 도구
├── compose.yml                 최소 로컬 PostgreSQL
├── compose.production.yml      전체 운영 서비스
├── compose.tailscale.yml       Funnel용 포트 오버라이드
├── compose.cloudflare.yml      Cloudflare Tunnel 오버라이드
├── Caddyfile                   직접 HTTPS 배포
├── Caddyfile.tunnel            터널 뒤 HTTP 리버스 프록시
├── DEPLOYMENT.md               DGX Spark 배포 이력
├── devel-QA.md                 제품 결정 이력
└── AGENTS.md                   작업 규칙
```

## 반드시 Git에 보존하는 폴더

- `apps/api/app`, `apps/api/migrations`, `apps/api/tests`
- `apps/web/app`, `apps/web/lib`, `apps/web/public`
- `deploy`, `docs`, `scripts`
- `models`와 `runtime` 아래의 `README.md`, `.gitkeep`
- 모든 Compose, Caddy, lockfile, 예제 환경변수 파일

## 별도 백업으로 보존하는 데이터

아래는 Git에 넣지 않습니다. 폴더 위치만 저장소가 보존합니다.

- PostgreSQL 데이터와 SQL 덤프
- Qdrant 스토리지와 스냅샷
- 사용자 업로드 및 음성
- Hugging Face 캐시와 모델 가중치
- 실제 `.env` 파일

백업과 복원은 [`MIGRATION_SPARK_TO_MAC.md`](MIGRATION_SPARK_TO_MAC.md)를 따릅니다.
