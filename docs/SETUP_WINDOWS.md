# Windows 개발 환경 설정

현재 개발 환경과 동일하게 **Windows + WSL2 Ubuntu + Docker Desktop** 조합을 사용합니다. 프로젝트를 `C:\`가 아니라 WSL의 Linux 파일시스템에 두어야 파일 감시와 Docker 빌드가 빠릅니다.

## 1. Windows 준비

관리자 PowerShell에서 WSL2와 Ubuntu를 설치합니다.

```powershell
wsl --install -d Ubuntu
```

설치가 끝나면 재부팅하고 Ubuntu를 처음 실행해 Linux 사용자명과 비밀번호를 만듭니다. 상태를 확인합니다.

```powershell
wsl --status
wsl --list --verbose
```

Ubuntu의 `VERSION`이 `2`가 아니면 변경합니다.

```powershell
wsl --set-version Ubuntu 2
```

## 2. Git과 Docker Desktop

1. Git for Windows를 설치합니다.
2. Docker Desktop for Windows를 설치합니다.
3. Docker Desktop의 `Settings > General > Use the WSL 2 based engine`을 켭니다.
4. `Settings > Resources > WSL Integration`에서 Ubuntu를 켭니다.
5. Docker Desktop을 재시작합니다.

Ubuntu 터미널에서 확인합니다.

```bash
docker version
docker compose version
git --version
```

`docker`가 없다고 나오면 Docker Desktop이 실행 중인지, Ubuntu WSL Integration이 켜졌는지 다시 확인합니다.

## 3. Ubuntu 기본 도구

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential openssl
```

Git 작성자를 설정합니다. GitHub에서 이메일 공개를 원하지 않으면 GitHub 설정에 표시되는 noreply 주소를 사용합니다.

```bash
git config --global user.name "본인 이름"
git config --global user.email "본인 GitHub 이메일 또는 noreply 이메일"
git config --global core.autocrlf input
```

## 4. Node.js 22와 npm

Node.js 22를 설치합니다. WSL Ubuntu 안에서 실행해야 하며 Windows용 Node를 재사용하지 않습니다. `nvm`의 최신 설치 명령은 공식 저장소의 Installation 항목에서 복사합니다.

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22
nvm use 22
```

고정된 설치 스크립트를 장기간 복사해 두는 대신 실행 전에 <https://github.com/nvm-sh/nvm>의 현재 명령과 내용을 확인합니다. 설치 후 아래 버전을 확인합니다.

```bash
node --version
npm --version
```

이 저장소는 Node 22와 lockfile 기반 `npm ci`를 사용합니다.

## 5. uv와 Python 3.12

공식 설치 스크립트를 검토한 뒤 실행합니다.

```bash
curl -LsSf https://astral.sh/uv/install.sh | less
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc
uv --version
uv python install 3.12
```

## 6. 저장소 받기

WSL 홈에 저장합니다.

```bash
mkdir -p ~/workspace
cd ~/workspace
git clone <PRIVATE_REPOSITORY_URL> star
cd star
```

권장 경로는 `/home/<사용자>/workspace/star`입니다. `/mnt/c/...`에 clone하지 않습니다.

## 7. 환경변수 만들기

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

`apps/api/.env`에서 로컬 주소를 확인합니다.

```dotenv
DATABASE_URL=postgresql+asyncpg://brown_chat:brown_chat@localhost:5432/brown_chat
FRONTEND_URL=http://localhost:3000
KAKAO_REDIRECT_URI=http://localhost:8000/api/v1/auth/oauth/kakao/callback
QDRANT_URL=http://localhost:6333
EMBEDDING_API_BASE_URL=http://localhost:7511
WHISPER_API_BASE_URL=http://localhost:8080
```

`JWT_SECRET_KEY`는 새 장비마다 새로 만듭니다.

```bash
openssl rand -hex 64
```

실제 값은 `.env`에만 넣고 Git에는 올리지 않습니다.

## 8. PostgreSQL과 API 실행

```bash
docker compose up -d postgres
docker compose ps

cd apps/api
uv sync --dev
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

확인 주소:

- <http://localhost:8000/api/v1/health>
- <http://localhost:8000/docs>

## 9. 웹 실행

새 Ubuntu 터미널에서 실행합니다.

```bash
cd ~/workspace/star/apps/web
npm ci
npm run dev
```

브라우저에서 <http://localhost:3000>을 엽니다.

## 10. 모델 연결

일반 Windows PC에서는 NVIDIA vLLM을 필수로 설치하지 않습니다. 다음 중 하나를 사용합니다.

1. 같은 네트워크의 OpenAI 호환 모델 서버
2. 개인 Mac의 MLX 모델 서버
3. 사용자가 선택한 외부 API
4. NVIDIA GPU와 WSL CUDA가 있을 때만 vLLM

`apps/api/.env`에서 바꿉니다.

```dotenv
CHAT_API_BASE_URL=http://모델서버주소:포트
CHAT_API_MODEL=모델의-served-model-name
CHAT_API_KEY=
```

모델 가중치를 저장소 폴더에 직접 복사하지 않습니다. 위치와 설치 방법은 [`../models/README.md`](../models/README.md)를 따릅니다.

## 11. 테스트

```bash
cd ~/workspace/star/apps/api
uv run pytest

cd ~/workspace/star/apps/web
npm run lint
npm run build
```

## 12. Windows에서 자주 생기는 문제

- 포트 `5432` 충돌: Windows PostgreSQL 서비스 또는 다른 Docker 컨테이너를 확인합니다.
- `localhost` 연결 실패: API가 WSL에서 `127.0.0.1:8000`으로 실행 중인지 확인합니다.
- 파일 변경이 느림: 저장소가 `/mnt/c`가 아닌 WSL 홈에 있는지 확인합니다.
- Docker 메모리 부족: Docker Desktop의 WSL 메모리 제한과 `%UserProfile%\.wslconfig`를 확인합니다.
- 이미지 빌드가 오래됨: `node_modules`와 `.next`를 Windows와 WSL 사이에서 복사하지 말고 `npm ci`로 재생성합니다.
