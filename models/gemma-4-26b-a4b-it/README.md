# Gemma 4 26B A4B IT

## 현재 Spark 설정

- Hugging Face ID: `google/gemma-4-26B-A4B-it`
- 서버: `vllm/vllm-openai:latest`
- 호스트 포트: `7510`
- 컨테이너 포트: `8000`
- GPU memory utilization: `0.7`
- max model length: `8192`
- Compose: `deploy/vllm-compose.yml`

DGX Spark에서는 다음 파일을 사용합니다.

```bash
cd deploy
docker compose -f vllm-compose.yml up -d
curl -fsS http://127.0.0.1:7510/v1/models | python3 -m json.tool
```

가중치는 `/home/ai-010/.cache/huggingface`에 내려받지만 Git에는 넣지 않습니다.

## Mac

NVIDIA vLLM Compose를 그대로 사용할 수 없습니다. Apple Silicon에서는 검증된 MLX 4비트 변환본 또는 직접 변환한 모델을 사용합니다.

```bash
uv venv .venv-mlx --python 3.12
source .venv-mlx/bin/activate
uv pip install mlx-lm
mlx_lm.server --model <검증한_MLX_모델_ID_또는_로컬_경로>
```

M4 Pro 기본 메모리에서는 26B 4비트가 실행되더라도 KV cache, 이미지 입력, 긴 컨텍스트와 동시 요청 때문에 메모리 압박이 생길 수 있습니다. 동시 생성 1개와 짧은 문맥으로 먼저 검증하고 필요하면 작은 모델로 변경합니다.

MLX 모델 ID는 실제 다운로드 직전에 라이선스·아키텍처 지원·VLM 지원을 확인한 뒤 문서에 고정합니다. 확인하지 않은 커뮤니티 모델 ID를 자동 설치 스크립트에 넣지 않습니다.
