import asyncio
import json
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from app.core.config import settings
from app.models.chat import ChatMessage
from app.services.attachments import extracted_attachment_text, image_data_url


class ChatAPIError(RuntimeError):
    pass


class ChatAPINotConfiguredError(ChatAPIError):
    pass


IMAGE_ANALYSIS_INSTRUCTION = (
    "이미지를 고해상도 원본 기준으로 주의 깊게 살펴보세요. 차트나 표라면 제목, 축, "
    "범례, 행과 열, 모델명과 수치를 먼저 확인한 뒤 핵심 비교와 의미를 설명하세요. "
    "작아서 확실히 읽히지 않는 글자나 수치는 추측해서 만들지 말고 불확실하다고 밝히세요."
)


@dataclass(frozen=True)
class CompletionMessage:
    role: str
    content: str


def chat_api_headers() -> dict[str, str]:
    if not settings.chat_api_base_url or not settings.chat_api_model:
        raise ChatAPINotConfiguredError(
            "CHAT_API_BASE_URL과 CHAT_API_MODEL을 설정하면 실제 답변 생성이 활성화됩니다."
        )
    headers = {"Content-Type": "application/json"}
    if settings.chat_api_key:
        headers["Authorization"] = f"Bearer {settings.chat_api_key}"
    return headers


async def chat_payload_messages(messages: list[ChatMessage]) -> list[dict[str, object]]:
    payload_messages: list[dict[str, object]] = [
        {"role": "system", "content": settings.chat_system_prompt}
    ]
    remaining_attachment_characters = settings.attachment_text_max_characters
    for message in messages:
        if not message.attachments:
            payload_messages.append({"role": message.role, "content": message.content})
            continue

        image_attachments = [
            attachment for attachment in message.attachments if attachment.kind == "image"
        ]
        text_parts = [message.content] if message.content else []
        if image_attachments:
            text_parts.append(IMAGE_ANALYSIS_INSTRUCTION)
        elif not text_parts:
            text_parts.append("첨부된 내용을 분석해 주세요.")
        try:
            image_urls = await asyncio.gather(
                *(image_data_url(attachment) for attachment in image_attachments)
            )
        except OSError as error:
            raise ChatAPIError("첨부 이미지를 불러오지 못했습니다.") from error
        image_parts: list[dict[str, object]] = [
            {"type": "image_url", "image_url": {"url": url, "detail": "high"}}
            for url in image_urls
        ]
        for attachment in message.attachments:
            if attachment.kind == "image":
                continue

            extracted = await extracted_attachment_text(attachment)
            excerpt = extracted[:remaining_attachment_characters]
            remaining_attachment_characters -= len(excerpt)
            if excerpt:
                text_parts.append(
                    f"\n[첨부파일: {attachment.original_filename}]\n{excerpt}\n[/첨부파일]"
                )
            else:
                text_parts.append(
                    f"\n[첨부파일: {attachment.original_filename} - 추출 가능한 텍스트가 없습니다.]"
                )

        content: str | list[dict[str, object]]
        combined_text = "\n".join(text_parts)
        if image_parts:
            content = [{"type": "text", "text": combined_text}, *image_parts]
        else:
            content = combined_text
        payload_messages.append({"role": message.role, "content": content})
    return payload_messages


def completion_temperature(messages: list[ChatMessage]) -> float:
    has_image = any(
        attachment.kind == "image"
        for message in messages
        for attachment in message.attachments
    )
    return settings.vlm_image_temperature if has_image else settings.chat_api_temperature


async def create_chat_completion(messages: list[ChatMessage]) -> CompletionMessage:
    headers = chat_api_headers()
    payload_messages = await chat_payload_messages(messages)
    try:
        async with httpx.AsyncClient(timeout=settings.chat_api_timeout_seconds) as client:
            response = await client.post(
                f"{settings.chat_api_base_url.rstrip('/')}/v1/chat/completions",
                headers=headers,
                json={
                    "model": settings.chat_api_model,
                    "messages": payload_messages,
                    "temperature": completion_temperature(messages),
                    "stream": False,
                },
            )
            response.raise_for_status()
            body = response.json()
            content = body["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as error:
        raise ChatAPIError("Chat API에서 유효한 응답을 받지 못했습니다.") from error

    if not isinstance(content, str) or not content.strip():
        raise ChatAPIError("Chat API 응답 내용이 비어 있습니다.")
    return CompletionMessage(role="assistant", content=content.strip())


def normalize_chat_title(raw_title: str) -> str:
    first_line = next(
        (line.strip() for line in raw_title.splitlines() if line.strip()),
        "",
    )
    first_line = first_line.strip(" \t\"'`*_#")
    title = re.sub(r"^(대화\s*)?제목\s*[:：]\s*", "", first_line, flags=re.IGNORECASE)
    title = re.sub(r"\s+", " ", title).strip(" \t\"'`*_#.,!?。")
    if not title:
        raise ChatAPIError("대화 제목이 비어 있습니다.")
    return title[:40].rstrip()


async def create_chat_title(user_content: str, assistant_content: str) -> str:
    headers = chat_api_headers()
    user_summary = user_content.strip() or "이미지 또는 첨부파일 분석 요청"
    try:
        async with httpx.AsyncClient(timeout=settings.chat_api_timeout_seconds) as client:
            response = await client.post(
                f"{settings.chat_api_base_url.rstrip('/')}/v1/chat/completions",
                headers=headers,
                json={
                    "model": settings.chat_api_model,
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "다음 대화의 핵심 주제와 작업을 나타내는 짧은 한국어 제목을 "
                                "한 줄로 작성하세요. 질문을 그대로 복사하지 말고 8~24자 정도의 "
                                "명사형으로 요약하세요. 이미지 분석이면 이미지의 핵심 대상과 분석 "
                                "목적을 포함하세요. 따옴표, 마침표, '제목:' 접두사는 쓰지 마세요."
                            ),
                        },
                        {
                            "role": "user",
                            "content": (
                                f"사용자 요청:\n{user_summary[:600]}\n\n"
                                f"답변 내용:\n{assistant_content[:1600]}"
                            ),
                        },
                    ],
                    "temperature": 0.2,
                    "max_tokens": 32,
                    "stream": False,
                },
            )
            response.raise_for_status()
            body = response.json()
            title = body["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as error:
        raise ChatAPIError("대화 제목을 생성하지 못했습니다.") from error
    if not isinstance(title, str):
        raise ChatAPIError("대화 제목 응답이 올바르지 않습니다.")
    return normalize_chat_title(title)


async def stream_chat_completion(messages: list[ChatMessage]) -> AsyncIterator[str]:
    headers = chat_api_headers()
    payload_messages = await chat_payload_messages(messages)
    received_content = False
    try:
        async with (
            httpx.AsyncClient(timeout=settings.chat_api_timeout_seconds) as client,
            client.stream(
                "POST",
                f"{settings.chat_api_base_url.rstrip('/')}/v1/chat/completions",
                headers=headers,
                json={
                    "model": settings.chat_api_model,
                    "messages": payload_messages,
                    "temperature": completion_temperature(messages),
                    "stream": True,
                },
            ) as response,
        ):
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                body = json.loads(data)
                content = body["choices"][0]["delta"].get("content")
                if isinstance(content, str) and content:
                    received_content = True
                    yield content
    except (httpx.HTTPError, json.JSONDecodeError, KeyError, IndexError, TypeError) as error:
        raise ChatAPIError("Chat API 스트림에서 유효한 응답을 받지 못했습니다.") from error

    if not received_content:
        raise ChatAPIError("Chat API 스트림 응답 내용이 비어 있습니다.")
