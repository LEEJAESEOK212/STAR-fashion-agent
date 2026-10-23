import logging
import uuid
from dataclasses import dataclass

import httpx
from qdrant_client import AsyncQdrantClient, models
from qdrant_client.http.exceptions import UnexpectedResponse

from app.core.config import settings
from app.models.chat import ChatMessage

logger = logging.getLogger(__name__)
_collection_ready = False


class MemoryServiceError(RuntimeError):
    pass


@dataclass(frozen=True)
class ChatTurn:
    user: ChatMessage
    assistant: ChatMessage


def completed_turns(messages: list[ChatMessage]) -> list[ChatTurn]:
    turns: list[ChatTurn] = []
    pending_user: ChatMessage | None = None
    for message in messages:
        if message.role == "user":
            pending_user = message
        elif message.role == "assistant" and pending_user is not None:
            turns.append(ChatTurn(user=pending_user, assistant=message))
            pending_user = None
    return turns


def message_search_text(message: ChatMessage) -> str:
    filenames = " ".join(attachment.original_filename for attachment in message.attachments)
    return " ".join(part for part in (message.content.strip(), filenames) if part).strip()


def turn_search_text(turn: ChatTurn) -> str:
    return message_search_text(turn.user) or "첨부파일 관련 질문"


async def embed_texts(texts: list[str]) -> list[list[float]]:
    if not settings.embedding_api_base_url or not settings.embedding_model:
        raise MemoryServiceError("임베딩 API가 설정되지 않았습니다.")
    headers = {"Content-Type": "application/json"}
    if settings.embedding_api_key:
        headers["Authorization"] = f"Bearer {settings.embedding_api_key}"
    try:
        async with httpx.AsyncClient(timeout=settings.embedding_timeout_seconds) as client:
            response = await client.post(
                f"{settings.embedding_api_base_url.rstrip('/')}/v1/embeddings",
                headers=headers,
                json={"model": settings.embedding_model, "input": texts},
            )
            response.raise_for_status()
            data = sorted(response.json()["data"], key=lambda item: item["index"])
            vectors = [item["embedding"] for item in data]
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as error:
        raise MemoryServiceError("임베딩 API에서 유효한 응답을 받지 못했습니다.") from error
    if len(vectors) != len(texts) or any(
        not isinstance(vector, list) or len(vector) != settings.embedding_vector_size
        for vector in vectors
    ):
        raise MemoryServiceError("임베딩 벡터 크기가 설정과 일치하지 않습니다.")
    return vectors


def qdrant_client() -> AsyncQdrantClient:
    if not settings.qdrant_url:
        raise MemoryServiceError("Qdrant가 설정되지 않았습니다.")
    return AsyncQdrantClient(url=settings.qdrant_url, timeout=settings.embedding_timeout_seconds)


async def ensure_collection(client: AsyncQdrantClient) -> None:
    global _collection_ready
    if _collection_ready:
        return
    try:
        exists = await client.collection_exists(settings.qdrant_collection)
        if not exists:
            try:
                await client.create_collection(
                    collection_name=settings.qdrant_collection,
                    vectors_config=models.VectorParams(
                        size=settings.embedding_vector_size,
                        distance=models.Distance.COSINE,
                    ),
                )
            except UnexpectedResponse as error:
                if error.status_code != 409:
                    raise
        for field_name in ("user_id", "session_id"):
            try:
                await client.create_payload_index(
                    collection_name=settings.qdrant_collection,
                    field_name=field_name,
                    field_schema=models.PayloadSchemaType.KEYWORD,
                    wait=True,
                )
            except UnexpectedResponse as error:
                if error.status_code != 409:
                    raise
    except Exception as error:
        raise MemoryServiceError("Qdrant 컬렉션을 준비하지 못했습니다.") from error
    _collection_ready = True


async def index_turns(turns: list[ChatTurn]) -> int:
    if not turns:
        return 0
    vectors = await embed_texts([turn_search_text(turn) for turn in turns])
    client = qdrant_client()
    try:
        await ensure_collection(client)
        await client.upsert(
            collection_name=settings.qdrant_collection,
            wait=True,
            points=[
                models.PointStruct(
                    id=str(turn.user.id),
                    vector=vector,
                    payload={
                        "user_id": str(turn.user.user_id),
                        "session_id": str(turn.user.session_id),
                        "user_message_id": str(turn.user.id),
                        "assistant_message_id": str(turn.assistant.id),
                        "created_at": turn.user.created_at.isoformat(),
                    },
                )
                for turn, vector in zip(turns, vectors, strict=True)
            ],
        )
    except Exception as error:
        raise MemoryServiceError("대화 기억을 Qdrant에 저장하지 못했습니다.") from error
    finally:
        await client.close()
    return len(turns)


async def search_similar_turn_ids(
    question: str,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    limit: int,
) -> list[uuid.UUID]:
    vector = (await embed_texts([question]))[0]
    client = qdrant_client()
    try:
        await ensure_collection(client)
        response = await client.query_points(
            collection_name=settings.qdrant_collection,
            query=vector,
            query_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="user_id", match=models.MatchValue(value=str(user_id))
                    ),
                    models.FieldCondition(
                        key="session_id", match=models.MatchValue(value=str(session_id))
                    ),
                ]
            ),
            limit=limit,
            score_threshold=(
                settings.chat_memory_score_threshold
                if settings.chat_memory_score_threshold > 0
                else None
            ),
            with_payload=True,
            with_vectors=False,
        )
    except Exception as error:
        raise MemoryServiceError("Qdrant 유사도 검색에 실패했습니다.") from error
    finally:
        await client.close()

    result: list[uuid.UUID] = []
    for point in response.points:
        try:
            result.append(uuid.UUID(str(point.payload["user_message_id"])))
        except (KeyError, TypeError, ValueError):
            logger.warning("Ignoring an invalid Qdrant chat-memory payload: %s", point.id)
    return result


async def delete_session_memory(session_id: uuid.UUID) -> None:
    client = qdrant_client()
    try:
        if not await client.collection_exists(settings.qdrant_collection):
            return
        await client.delete(
            collection_name=settings.qdrant_collection,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="session_id",
                            match=models.MatchValue(value=str(session_id)),
                        )
                    ]
                )
            ),
            wait=True,
        )
    except Exception as error:
        raise MemoryServiceError("Qdrant 대화 기억을 삭제하지 못했습니다.") from error
    finally:
        await client.close()


async def semantic_context(messages: list[ChatMessage]) -> list[ChatMessage]:
    if not messages or messages[-1].role != "user":
        return messages
    pending_start = len(messages) - 1
    while pending_start > 0 and messages[pending_start - 1].role == "user":
        pending_start -= 1
    pending_users = messages[pending_start:]
    current = pending_users[-1]
    turns = completed_turns(messages[:pending_start])
    limit = settings.chat_memory_top_k
    if len(turns) <= limit:
        selected = turns
    else:
        question = message_search_text(current) or "첨부파일 관련 질문"
        similar_ids = await search_similar_turn_ids(
            question=question,
            user_id=current.user_id,
            session_id=current.session_id,
            limit=limit,
        )
        positions = {turn.user.id: index for index, turn in enumerate(turns)}
        selected = [turn for turn in turns if turn.user.id in set(similar_ids)]
        if len(selected) < limit:
            selected_ids = {turn.user.id for turn in selected}
            for turn in reversed(turns):
                if turn.user.id not in selected_ids:
                    selected.append(turn)
                    selected_ids.add(turn.user.id)
                if len(selected) == limit:
                    break
        latest_interrupted = next(
            (turn for turn in reversed(turns) if turn.assistant.is_interrupted),
            None,
        )
        if latest_interrupted and all(
            turn.user.id != latest_interrupted.user.id for turn in selected
        ):
            selected = [
                *(selected[-(limit - 1):] if limit > 1 else []),
                latest_interrupted,
            ]
        selected.sort(key=lambda turn: positions[turn.user.id])
    return [
        message
        for turn in selected
        for message in (turn.user, turn.assistant)
    ] + pending_users
