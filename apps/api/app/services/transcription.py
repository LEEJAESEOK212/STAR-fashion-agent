from pathlib import Path

import httpx

from app.core.config import settings


class TranscriptionError(RuntimeError):
    pass


class TranscriptionNotConfiguredError(TranscriptionError):
    pass


async def transcribe_audio(
    *, filename: str, content_type: str, content: bytes
) -> str:
    if not settings.whisper_api_base_url:
        raise TranscriptionNotConfiguredError("음성 전사 서비스가 설정되지 않았습니다.")

    safe_filename = Path(filename).name or "recording.webm"
    try:
        async with httpx.AsyncClient(timeout=settings.whisper_timeout_seconds) as client:
            response = await client.post(
                f"{settings.whisper_api_base_url.rstrip('/')}/inference",
                data={
                    "response_format": "json",
                    "language": settings.whisper_language,
                },
                files={"file": (safe_filename, content, content_type)},
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise TranscriptionError("Whisper 음성 전사 요청에 실패했습니다.") from error

    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str) or not text.strip():
        raise TranscriptionError("음성에서 인식된 문장이 없습니다.")
    return text.strip()
