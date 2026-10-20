# 이관 전 검증 기록

기준일: 2026-10-20

## 완료된 검증

- FastAPI 테스트: `19 passed`
- 모든 `scripts/*.sh`: `bash -n` 문법 검사 통과
- 운영 Compose와 Tailscale override: `docker compose config --quiet` 통과
- 저장소 안의 상대 Markdown 링크: 누락 없음
- Git 후보 파일의 개인키·대표 API 키 패턴 검사: 검출 없음
- `.env`, `.venv`, `node_modules`, `.next`, Python cache, 모델 가중치가 Git에서 제외되는지 확인
- Git에 포함되는 최대 단일 파일: 약 6.5MB로 일반 Git 범위

Python 3.14에서 테스트했기 때문에 `pytest-asyncio`와 Starlette의 향후 제거 예정 API 경고가 발생했지만 실패는 없습니다. 새 Mac에서는 문서의 기준 버전인 Python 3.12를 사용합니다.

## 현재 장비에서 미완료된 검증

현재 WSL Ubuntu에 `npm`이 설치되어 있지 않고 Docker Desktop 데몬도 꺼져 있어 아래 두 검증은 실행하지 못했습니다.

```bash
cd apps/web
npm ci
npm run lint
npm run build
```

새 장비에서 [`SETUP_WINDOWS.md`](SETUP_WINDOWS.md) 또는 [`SETUP_MACOS.md`](SETUP_MACOS.md)의 Node 22 설치를 끝낸 직후 반드시 실행합니다.

## Spark 종료 전 최종 점검

```bash
cd ~/brown-chat
git status
./scripts/export-portable-backup.sh .env.production
docker compose --env-file .env.production -f compose.production.yml -f compose.tailscale.yml ps
tailscale funnel status
```

그 다음 [`MIGRATION_SPARK_TO_MAC.md`](MIGRATION_SPARK_TO_MAC.md)의 복원 완료 기준을 Mac에서 전부 확인합니다. Spark 원본과 최종 백업은 Mac 복원 검증 전까지 삭제하지 않습니다.
