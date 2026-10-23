import uuid
from datetime import UTC, datetime

import pytest

from app.models.chat import ChatAttachment, ChatMessage
from app.services import chat_completion


class FakeStreamResponse:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    def raise_for_status(self) -> None:
        return None

    async def aiter_lines(self):
        yield 'data: {"choices":[{"delta":{"role":"assistant"}}]}'
        yield 'data: {"choices":[{"delta":{"content":"안녕"}}]}'
        yield 'data: {"choices":[{"delta":{"content":"하세요"}}]}'
        yield "data: [DONE]"


class FakeAsyncClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    def stream(self, *args, **kwargs) -> FakeStreamResponse:
        assert kwargs["json"]["stream"] is True
        return FakeStreamResponse()


@pytest.mark.asyncio
async def test_stream_chat_completion_yields_text_deltas(monkeypatch) -> None:
    monkeypatch.setattr(chat_completion.settings, "chat_api_base_url", "http://chat-api")
    monkeypatch.setattr(chat_completion.settings, "chat_api_model", "test-model")
    monkeypatch.setattr(chat_completion.httpx, "AsyncClient", lambda **kwargs: FakeAsyncClient())
    message = ChatMessage(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        role="user",
        content="인사해 줘",
        created_at=datetime.now(UTC),
    )
    message.attachments = []

    chunks = [chunk async for chunk in chat_completion.stream_chat_completion([message])]

    assert chunks == ["안녕", "하세요"]


@pytest.mark.parametrize(
    ("raw_title", "expected"),
    [
        ("제목: LLM 벤치마킹 순위 차트 분석", "LLM 벤치마킹 순위 차트 분석"),
        ('"대화 제목: 한국 여행 일정 설계."', "한국 여행 일정 설계"),
        ("\n  코드 오류 원인 진단  \n추가 설명", "코드 오류 원인 진단"),
    ],
)
def test_normalize_chat_title(raw_title: str, expected: str) -> None:
    assert chat_completion.normalize_chat_title(raw_title) == expected


def image_message() -> ChatMessage:
    user_id = uuid.uuid4()
    message = ChatMessage(
        id=uuid.uuid4(),
        user_id=user_id,
        session_id=uuid.uuid4(),
        role="user",
        content="",
        created_at=datetime.now(UTC),
    )
    message.attachments = [
        ChatAttachment(
            id=uuid.uuid4(),
            user_id=user_id,
            kind="image",
            original_filename="chart.png",
            storage_name="chart.png",
            content_type="image/png",
            size_bytes=123,
            created_at=datetime.now(UTC),
        )
    ]
    return message


def test_image_completion_uses_lower_temperature(monkeypatch) -> None:
    monkeypatch.setattr(chat_completion.settings, "chat_api_temperature", 0.7)
    monkeypatch.setattr(chat_completion.settings, "vlm_image_temperature", 0.2)

    assert chat_completion.completion_temperature([image_message()]) == 0.2


@pytest.mark.asyncio
async def test_image_payload_requests_careful_high_detail_analysis(monkeypatch) -> None:
    async def fake_image_data_url(_attachment: ChatAttachment) -> str:
        return "data:image/png;base64,abc"

    monkeypatch.setattr(chat_completion, "image_data_url", fake_image_data_url)

    payload = await chat_completion.chat_payload_messages([image_message()])
    content = payload[1]["content"]

    assert isinstance(content, list)
    assert "추측해서 만들지 말고" in content[0]["text"]
    assert content[1]["image_url"]["detail"] == "high"


@pytest.mark.asyncio
async def test_interrupted_answer_adds_continue_without_repeating_instruction() -> None:
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()
    interrupted = ChatMessage(
        id=uuid.uuid4(),
        user_id=user_id,
        session_id=session_id,
        role="assistant",
        content="1, 2, 3, 4, 5",
        is_interrupted=True,
        created_at=datetime.now(UTC),
    )
    interrupted.attachments = []
    follow_up = ChatMessage(
        id=uuid.uuid4(),
        user_id=user_id,
        session_id=session_id,
        role="user",
        content="10까지 이어서 세어줘",
        created_at=datetime.now(UTC),
    )
    follow_up.attachments = []

    payload = await chat_completion.chat_payload_messages([interrupted, follow_up])

    assert payload[1] == {"role": "assistant", "content": "1, 2, 3, 4, 5"}
    assert payload[2]["role"] == "system"
    assert "명확히 그 작업의 연장을 요구할 때만" in payload[2]["content"]
    assert "'1부터'처럼 새 시작점을 명시하면" in payload[2]["content"]
    assert payload[3] == {"role": "user", "content": "10까지 이어서 세어줘"}


@pytest.mark.asyncio
async def test_repeated_user_request_marks_previous_request_as_canceled() -> None:
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()
    first = ChatMessage(
        id=uuid.uuid4(), user_id=user_id, session_id=session_id,
        role="user", content="1부터 100까지 세어줘", created_at=datetime.now(UTC),
    )
    second = ChatMessage(
        id=uuid.uuid4(), user_id=user_id, session_id=session_id,
        role="user", content="1부터 100까지 세어줘", created_at=datetime.now(UTC),
    )
    first.attachments = []
    second.attachments = []

    payload = await chat_completion.chat_payload_messages([first, second])

    assert payload[1] == {"role": "user", "content": "1부터 100까지 세어줘"}
    assert payload[2]["role"] == "system"
    assert "완전히 취소" in payload[2]["content"]
    assert "시작점부터 새로" in payload[2]["content"]
    assert payload[3] == {"role": "user", "content": "1부터 100까지 세어줘"}
