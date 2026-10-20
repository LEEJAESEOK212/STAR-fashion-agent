# 모델 폴더

이 폴더에는 모델 가중치를 커밋하지 않습니다. 하위 폴더 이름과 설치 문서만 Git에 남겨 새 장비에서 같은 역할을 재구성합니다.

```text
models/
├── gemma-4-26b-a4b-it/   대화·VLM 생성 모델
├── bge-m3/                1024차원 텍스트 임베딩
└── whisper-small/         한국어 음성 전사
```

실제 다운로드 위치는 운영체제와 런타임에 따라 다릅니다.

- DGX Spark/vLLM: `/home/ai-010/.cache/huggingface`
- Mac MLX/Hugging Face: 기본적으로 `~/.cache/huggingface`
- whisper.cpp 운영 Compose: Docker volume `brown_chat_whisper_models`

Git이 무시하는 확장자에는 `.safetensors`, `.gguf`, `.bin`, `.onnx`, `.pt`, `.pth`, `.ckpt`가 포함됩니다.

## 공통 검증

모델을 받기 전에 다음을 기록합니다.

- 정확한 저장소 ID
- revision 또는 commit hash
- 라이선스와 상업 사용 가능 여부
- 양자화 형식
- 요구 메모리
- served model name
- 컨텍스트 길이
- 이미지 입력 지원 여부

모델을 교체하면 `.env`의 모델명뿐 아니라 임베딩 차원, Qdrant 컬렉션 재생성, 평가셋 결과를 함께 갱신합니다.
