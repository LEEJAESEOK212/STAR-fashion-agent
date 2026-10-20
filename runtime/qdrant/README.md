# Qdrant 데이터

실제 벡터 인덱스와 스냅샷은 Git에 커밋하지 않습니다. 복원이 실패해도 PostgreSQL 원문과 동일한 임베딩 모델이 있으면 `app.scripts.backfill_chat_memory`로 재생성할 수 있습니다.
