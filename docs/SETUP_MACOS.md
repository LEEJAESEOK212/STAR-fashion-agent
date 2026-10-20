# Apple Silicon Mac 설정

이 문서는 M4 Pro를 포함한 Apple Silicon Mac에서 STAR 전체 스택을 복원하는 절차입니다. 앱·DB·검색은 Docker와 네이티브 개발 도구로 실행하고, 로컬 LLM은 NVIDIA vLLM 대신 MLX 계열 서버를 사용합니다.

## 1. macOS 기본 준비

터미널에서 Command Line Tools를 설치합니다.

```bash
xcode-select --install
```

Homebrew가 없다면 공식 사이트의 최신 설치 명령을 사용합니다. 설치 후 Apple Silicon 기본 경로를 셸에 연결합니다.

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
brew update
```

## 2. 필수 프로그램

```bash
brew install git node@22 uv openssl
brew install --cask docker
```

Homebrew의 버전 지정 Node는 자동으로 `PATH`에 연결되지 않을 수 있습니다. Apple Silicon 기본 경로를 셸에 영구 등록합니다.

```bash
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Docker Desktop을 Applications에서 한 번 실행하고 약관과 권한 설정을 완료합니다. 확인합니다.

```bash
git --version
node --version
npm --version
uv --version
docker version
docker compose version
```

Docker 명령은 Docker Desktop이 실행 중일 때만 동작합니다.

## 3. Git 설정과 clone

```bash
git config --global user.name "본인 이름"
git config --global user.email "본인 GitHub 이메일 또는 noreply 이메일"
git config --global core.autocrlf input

mkdir -p ~/workspace
cd ~/workspace
git clone <PRIVATE_REPOSITORY_URL> star
cd star
```

## 4. 로컬 환경변수

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

새 JWT secret을 생성해 `apps/api/.env`에 넣습니다.

```bash
openssl rand -hex 64
```

로컬 기본 주소는 다음과 같습니다.

```dotenv
DATABASE_URL=postgresql+asyncpg://brown_chat:brown_chat@localhost:5432/brown_chat
FRONTEND_URL=http://localhost:3000
KAKAO_REDIRECT_URI=http://localhost:8000/api/v1/auth/oauth/kakao/callback
QDRANT_URL=http://localhost:6333
CHAT_API_BASE_URL=http://127.0.0.1:8080
```

## 5. DB와 애플리케이션 실행

```bash
docker compose up -d postgres

cd apps/api
uv sync --dev
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

새 터미널에서 웹을 실행합니다.

```bash
cd ~/workspace/star/apps/web
npm ci
npm run dev
```

확인합니다.

- <http://localhost:3000>
- <http://localhost:8000/api/v1/health>
- <http://localhost:8000/docs>

## 6. MLX 로컬 모델 서버

가중치는 Git에 없으며 `models/gemma-4-26b-a4b-it/README.md`의 조건을 먼저 확인합니다. MLX-LM은 기본적인 OpenAI 유사 API를 제공하지만 공식 문서도 프로덕션 서버로 권장하지 않으므로 개인 개발용으로 사용합니다.

```bash
cd ~/workspace/star
uv venv .venv-mlx --python 3.12
source .venv-mlx/bin/activate
uv pip install mlx-lm
mlx_lm.server --help
mlx_lm.server --model <검증한_MLX_모델_경로_또는_Hugging_Face_ID>
```

기본 서버는 `127.0.0.1:8080`에서 실행됩니다. 먼저 단독 요청을 확인합니다.

```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"안녕"}],"temperature":0.2}'
```

26B 4비트는 메모리에 들어가더라도 긴 컨텍스트·VLM 이미지·동시 요청에서 여유가 작을 수 있습니다. 처음에는 동시 생성 1개, 짧은 컨텍스트로 검증하고 부족하면 12B 또는 4B 모델로 교체합니다. 텍스트용 MLX-LM과 이미지 입력 지원 여부는 별도 검증해야 하며, VLM 호환이 확인되지 않으면 이미지 분석은 외부 API 또는 더 작은 MLX-VLM 호환 모델을 사용합니다.

## 7. Docker 컨테이너에서 Mac 모델 호출

API를 Docker로 실행하면 컨테이너의 `localhost`는 Mac이 아닙니다. 다음 주소를 사용합니다.

```dotenv
CHAT_API_BASE_URL=http://host.docker.internal:8080
```

API를 `uvicorn`으로 Mac에서 직접 실행하면 다음 주소를 사용합니다.

```dotenv
CHAT_API_BASE_URL=http://127.0.0.1:8080
```

## 8. Spark 데이터 복원

[`MIGRATION_SPARK_TO_MAC.md`](MIGRATION_SPARK_TO_MAC.md)의 백업을 받은 뒤 순서대로 복원합니다.

1. PostgreSQL
2. 업로드 파일
3. Qdrant
4. 환경변수 재작성
5. 모델 재다운로드
6. OAuth Redirect URI 변경
7. 로컬 전체 테스트

## 9. Mac을 외부 서버로 사용할 때

Mac이 잠들거나 Docker Desktop이 종료되면 서비스도 중단됩니다. 공개 운영 시에는 전원 연결, 자동 재시작, 디스크 암호화, 백업을 설정해야 합니다. Tailscale Funnel과 Cloudflare Tunnel 절차는 [`NETWORKING.md`](NETWORKING.md)를 따릅니다.

## 10. 공식 참고자료

- Docker Desktop for Mac: <https://docs.docker.com/desktop/setup/install/mac-install/>
- uv 설치: <https://docs.astral.sh/uv/getting-started/installation/>
- MLX-LM: <https://github.com/ml-explore/mlx-lm>
- Tailscale macOS: <https://tailscale.com/docs/install/mac>
