# 런타임 데이터 위치

이 폴더는 Git에 올리지 않는 실데이터의 논리적 구조를 보존합니다. 하위 `README.md`와 `.gitkeep`만 추적됩니다.

- `postgres`: DB 덤프 또는 bind mount를 사용할 때의 위치
- `qdrant`: 벡터 스냅샷과 복원 위치
- `uploads`: 사용자 첨부파일의 별도 백업 위치
- `backups`: 이관 패키지 생성 위치
- `huggingface`: 모델 캐시를 명시적으로 프로젝트 아래 둘 때의 위치

현재 운영 Compose는 이 폴더가 아니라 Docker named volume을 사용합니다. 운영 중 volume을 임의로 bind mount로 바꾸면 기존 데이터가 빈 것처럼 보일 수 있으므로 먼저 `MIGRATION_SPARK_TO_MAC.md`에 따라 내보냅니다.
