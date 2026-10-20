# Whisper small

- 런타임: `whisper.cpp`
- 컨테이너: `ghcr.io/ggml-org/whisper.cpp:main-arm64`
- 모델 이름: `small`
- 모델 파일: `ggml-small.bin`
- 기본 언어: `ko`
- 기본 스레드: `8`
- 컨테이너 포트: `8080`

`compose.production.yml`의 `whisper` 서비스는 모델이 없을 때 공식 `download-ggml-model.sh`를 실행해 Docker volume의 `/models`에 받습니다.

```bash
docker compose --env-file .env.production \
  -f compose.production.yml up -d whisper
docker compose --env-file .env.production \
  -f compose.production.yml logs -f whisper
```

Mac에서도 arm64 컨테이너를 우선 시험합니다. 네이티브 whisper.cpp 또는 다른 MLX Whisper 서버로 교체할 경우 FastAPI가 기대하는 multipart 전사 API 계약을 먼저 확인합니다.

모델 파일은 재다운로드 가능하므로 Git과 기본 Spark 이관 백업에서 제외합니다.
