# BGE-M3

- 모델 ID: `BAAI/bge-m3`
- 역할: 채팅 턴과 향후 패션 텍스트 검색용 임베딩
- 벡터 크기: `1024`
- 현재 서버: vLLM pooling runner
- 기본 최대 길이: `2048`
- 운영 GPU memory utilization: `0.1`

현재 운영 Compose는 서비스 시작 시 Hugging Face 캐시에 모델이 없으면 다운로드합니다.

```yaml
command:
  - --model
  - BAAI/bge-m3
  - --runner
  - pooling
```

모델이나 벡터 크기를 변경하면 기존 Qdrant 컬렉션과 호환되지 않습니다. 새 컬렉션을 만들거나 PostgreSQL을 원본으로 전체 벡터를 다시 생성합니다.

Mac에서 동일한 NVIDIA vLLM 구성을 강제하지 않습니다. CPU·Metal 호환 임베딩 런타임 또는 외부 임베딩 서버를 선택하고 OpenAI 호환 `/v1/embeddings` 계약을 유지합니다.
