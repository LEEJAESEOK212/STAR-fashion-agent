from io import BytesIO

import httpx
import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app.api.routes import chat
from app.core.config import settings
from app.services import transcription


class FakeResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, str]:
        return {"text": "  음성으로 만든 질문입니다.  "}


class FakeAsyncClient:
    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs

    async def __aenter__(self) -> "FakeAsyncClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        return None

    async def post(self, *args: object, **kwargs: object) -> FakeResponse:
        return FakeResponse()


@pytest.mark.asyncio
async def test_transcribe_audio_returns_trimmed_text(monkeypatch) -> None:
    monkeypatch.setattr(settings, "whisper_api_base_url", "http://whisper:8080")
    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    text = await transcription.transcribe_audio(
        filename="recording.webm",
        content_type="audio/webm",
        content=b"audio",
    )

    assert text == "음성으로 만든 질문입니다."


@pytest.mark.asyncio
async def test_transcription_route_rejects_unsupported_media_type() -> None:
    upload = UploadFile(
        filename="recording.txt",
        file=BytesIO(b"not audio"),
        headers=Headers({"content-type": "text/plain"}),
    )

    with pytest.raises(HTTPException, match="지원하지 않는 음성") as raised:
        await chat.create_transcription(current_user=object(), file=upload)  # type: ignore[arg-type]

    assert raised.value.status_code == 422
