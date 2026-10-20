import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.chat import ChatMessage
from app.services import chat_memory


def message(
    role: str,
    content: str,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    offset: int,
) -> ChatMessage:
    item = ChatMessage(
        id=uuid.uuid4(),
        user_id=user_id,
        session_id=session_id,
        role=role,
        content=content,
        created_at=datetime.now(UTC) + timedelta(seconds=offset),
    )
    item.attachments = []
    return item


def conversation(turn_count: int) -> tuple[list[ChatMessage], list[ChatMessage]]:
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()
    all_messages: list[ChatMessage] = []
    questions: list[ChatMessage] = []
    for index in range(turn_count):
        question = message("user", f"질문 {index}", user_id, session_id, index * 2)
        answer = message("assistant", f"답변 {index}", user_id, session_id, index * 2 + 1)
        questions.append(question)
        all_messages.extend([question, answer])
    all_messages.append(message("user", "현재 질문", user_id, session_id, turn_count * 2))
    return all_messages, questions


@pytest.mark.asyncio
async def test_three_or_fewer_turns_are_used_without_vector_search(monkeypatch) -> None:
    messages, _ = conversation(3)

    async def unexpected_search(*args, **kwargs):
        raise AssertionError("vector search should not run")

    monkeypatch.setattr(chat_memory, "search_similar_turn_ids", unexpected_search)
    context = await chat_memory.semantic_context(messages)

    assert [item.content for item in context] == [item.content for item in messages]


@pytest.mark.asyncio
async def test_more_than_three_turns_use_three_semantically_selected_turns(monkeypatch) -> None:
    messages, questions = conversation(5)
    selected_ids = [questions[4].id, questions[1].id, questions[3].id]

    async def selected_search(*args, **kwargs):
        return selected_ids

    monkeypatch.setattr(chat_memory, "search_similar_turn_ids", selected_search)
    context = await chat_memory.semantic_context(messages)

    assert [item.content for item in context] == [
        "질문 1",
        "답변 1",
        "질문 3",
        "답변 3",
        "질문 4",
        "답변 4",
        "현재 질문",
    ]
