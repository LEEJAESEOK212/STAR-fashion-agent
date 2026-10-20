import base64
from io import BytesIO
from uuid import uuid4

import pytest
from fastapi import UploadFile
from PIL import Image

from app.core.config import settings
from app.services.attachments import (
    AttachmentValidationError,
    extracted_attachment_text,
    image_data_url,
    save_upload,
)


@pytest.mark.asyncio
async def test_save_and_extract_text_attachment(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    upload = UploadFile(filename="notes.txt", file=BytesIO("한글 문서 내용".encode()))

    attachment = await save_upload(upload, "file", uuid4())

    assert attachment.original_filename == "notes.txt"
    assert attachment.content_type == "text/plain"
    assert await extracted_attachment_text(attachment) == "한글 문서 내용"


@pytest.mark.asyncio
async def test_rejects_invalid_image(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    upload = UploadFile(filename="fake.png", file=BytesIO(b"not an image"))

    with pytest.raises(AttachmentValidationError, match="올바른 이미지"):
        await save_upload(upload, "image", uuid4())


@pytest.mark.asyncio
async def test_vlm_image_payload_is_resized_without_changing_original(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    monkeypatch.setattr(settings, "vlm_image_max_dimension", 256)
    source = BytesIO()
    Image.new("RGB", (1024, 512), "brown").save(source, format="PNG")
    original = source.getvalue()
    upload = UploadFile(filename="large.png", file=BytesIO(original))

    attachment = await save_upload(upload, "image", uuid4())
    result = await image_data_url(attachment)

    header, encoded = result.split(",", 1)
    assert header == "data:image/jpeg;base64"
    with Image.open(BytesIO(base64.b64decode(encoded))) as resized:
        assert resized.size == (256, 128)
    assert (tmp_path / attachment.storage_name).read_bytes() == original
