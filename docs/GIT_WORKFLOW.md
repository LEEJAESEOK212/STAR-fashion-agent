# Git과 GitHub 작업 방식

## 저장소 정책

STAR 저장소는 반드시 **비공개 저장소**로 운영합니다. 소스와 디자인 원본은 커밋하지만 비밀값, 사용자 데이터, 모델 가중치는 커밋하지 않습니다.

## 최초 연결

GitHub에서 빈 private repository를 만든 뒤 로컬에서 실행합니다.

```bash
git init -b main
git config user.name "본인 GitHub 표시 이름"
git config user.email "본인 GitHub 이메일 또는 GitHub noreply 이메일"
git add .
git status
git commit -m "chore: preserve STAR application and migration docs"
git remote add origin <PRIVATE_REPOSITORY_URL>
git push -u origin main
```

원격 저장소에 README나 라이선스를 자동 생성하지 않습니다. 로컬 이력이 첫 커밋이 되어야 불필요한 병합이 생기지 않습니다.

## 일상 작업

```bash
git switch -c feature/작업명
# 파일 수정
git diff --check
git status
git add <확인한 파일>
git commit -m "feat: 변경 내용"
git push -u origin feature/작업명
```

작은 개인 프로젝트라도 `main`에 바로 덮어쓰기보다 기능 브랜치를 사용하면 잘못된 UI나 마이그레이션을 되돌리기 쉽습니다.

## 커밋 전 필수 확인

```bash
git status --ignored
git diff --cached
git grep -n -I -E 'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}' --cached
```

다음 항목이 보이면 커밋을 중지합니다.

- `.env`, `.env.production`
- Client Secret, API 키, 비밀번호, access token
- DB 덤프, 사용자 업로드, 음성 파일
- `node_modules`, `.next`, `.venv`
- `.safetensors`, `.gguf`, `.bin` 같은 모델 가중치

## 디자인 파일

현재 디자인 PNG/JPG는 GitHub 단일 파일 제한보다 작아 일반 Git으로 관리합니다. 향후 원본 PSD, 대형 영상, 100MB 이상의 자산이 생기면 Git LFS를 도입합니다. 기존 이미지를 Git LFS로 소급 이동하기 전에는 반드시 저장소 백업을 만듭니다.

## 릴리스 태그

안정 배포마다 태그를 남깁니다.

```bash
git tag -a star-v0.1.0 -m "STAR Spark migration baseline"
git push origin star-v0.1.0
```

DB 마이그레이션과 애플리케이션 태그는 함께 기록하고, DB 실데이터 백업은 Git 밖에서 같은 태그 이름으로 보관합니다.
