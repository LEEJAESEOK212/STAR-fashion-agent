import json
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from time import perf_counter
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DatabaseSession
from app.core.config import settings
from app.models.chat import ChatAttachment, ChatMessage, ChatProject, ChatSession
from app.schemas.chat import (
    ChatAttachmentResponse,
    ChatGenerationResponse,
    ChatGenerationControl,
    ChatInput,
    ChatInterruptedOutput,
    ChatMessageResponse,
    ChatProjectCreate,
    ChatProjectResponse,
    ChatProjectUpdate,
    ChatSessionDetail,
    ChatSessionSummary,
    ChatSessionUpdate,
    TranscriptionResponse,
)
from app.services.attachments import (
    AttachmentValidationError,
    attachment_path,
    remove_stored_file,
    save_upload,
)
from app.services.chat_completion import (
    ChatAPIError,
    ChatAPINotConfiguredError,
    create_chat_completion,
    create_chat_title,
    stream_chat_completion,
)
from app.services.chat_memory import (
    ChatTurn,
    MemoryServiceError,
    completed_turns,
    delete_session_memory,
    index_turns,
    semantic_context,
)
from app.services.transcription import (
    TranscriptionError,
    TranscriptionNotConfiguredError,
    transcribe_audio,
)

router = APIRouter()
logger = logging.getLogger(__name__)

ALLOWED_AUDIO_CONTENT_TYPES = {
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "audio/webm",
    "video/mp4",
    "video/webm",
}

GUEST_CHAT_MAX_TURNS = 3

RESUME_GENERATION_PROMPT = (
    "방금 일시정지된 답변을 화면에 이미 표시된 마지막 지점 바로 다음부터 이어서 작성하세요. "
    "표시된 내용을 반복하거나 처음부터 다시 시작하지 말고, 남은 내용만 작성하세요."
)


@dataclass
class GuestCompletionMessage:
    role: str
    content: str
    attachments: list[ChatAttachment]
    is_interrupted: bool = False


def stream_event(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def owned_session(
    session_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession
) -> ChatSession:
    session = await db.scalar(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == current_user.id,
        )
    )
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="대화를 찾을 수 없습니다.",
        )
    return session


async def owned_project(
    project_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession
) -> ChatProject:
    project = await db.scalar(
        select(ChatProject).where(
            ChatProject.id == project_id,
            ChatProject.user_id == current_user.id,
        )
    )
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="프로젝트를 찾을 수 없습니다.",
        )
    return project


async def session_messages(session_id: uuid.UUID, db: DatabaseSession) -> list[ChatMessage]:
    result = await db.scalars(
        select(ChatMessage)
        .options(selectinload(ChatMessage.attachments))
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at, ChatMessage.id)
    )
    return list(result)


async def generation_context(messages: list[ChatMessage]) -> list[ChatMessage]:
    try:
        return await semantic_context(messages)
    except MemoryServiceError:
        logger.exception("Semantic chat memory is unavailable; using recent turns.")
        pending_start = len(messages) - 1
        while pending_start > 0 and messages[pending_start - 1].role == "user":
            pending_start -= 1
        pending_users = messages[pending_start:]
        recent_turns = completed_turns(messages[:pending_start])[-settings.chat_memory_top_k :]
        return [
            message
            for turn in recent_turns
            for message in (turn.user, turn.assistant)
        ] + pending_users


async def pending_attachments(
    attachment_ids: list[uuid.UUID], current_user: CurrentUser, db: DatabaseSession
) -> list[ChatAttachment]:
    if len(attachment_ids) > settings.upload_max_attachments_per_message:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"첨부파일은 메시지당 최대 {settings.upload_max_attachments_per_message}개입니다."
            ),
        )
    if len(set(attachment_ids)) != len(attachment_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="중복된 첨부파일이 포함되어 있습니다.",
        )
    if not attachment_ids:
        return []
    result = await db.scalars(
        select(ChatAttachment).where(
            ChatAttachment.id.in_(attachment_ids),
            ChatAttachment.user_id == current_user.id,
            ChatAttachment.message_id.is_(None),
        )
    )
    attachments_by_id = {attachment.id: attachment for attachment in result}
    if len(attachments_by_id) != len(attachment_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="사용할 수 없는 첨부파일이 포함되어 있습니다.",
        )
    return [attachments_by_id[attachment_id] for attachment_id in attachment_ids]


def message_response(
    message: ChatMessage, attachments: list[ChatAttachment] | None = None
) -> ChatMessageResponse:
    return ChatMessageResponse(
        id=message.id,
        user_id=message.user_id,
        session_id=message.session_id,
        role=message.role,
        content=message.content,
        is_interrupted=message.is_interrupted,
        generation_duration_ms=message.generation_duration_ms,
        created_at=message.created_at,
        attachments=attachments if attachments is not None else message.attachments,
    )


def detail_response(session: ChatSession, messages: list[ChatMessage]) -> ChatSessionDetail:
    return ChatSessionDetail(
        id=session.id,
        user_id=session.user_id,
        project_id=session.project_id,
        title=session.title,
        is_pinned=session.is_pinned,
        created_at=session.created_at,
        updated_at=session.updated_at,
        messages=[message_response(message) for message in messages],
    )


@router.post(
    "/projects", response_model=ChatProjectResponse, status_code=status.HTTP_201_CREATED
)
async def create_project(
    payload: ChatProjectCreate, current_user: CurrentUser, db: DatabaseSession
) -> ChatProject:
    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="프로젝트 이름을 입력해 주세요.",
        )
    if payload.parent_id is not None:
        await owned_project(payload.parent_id, current_user, db)
    project = ChatProject(
        user_id=current_user.id,
        parent_id=payload.parent_id,
        name=name,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.get("/projects", response_model=list[ChatProjectResponse])
async def list_projects(
    current_user: CurrentUser, db: DatabaseSession
) -> list[ChatProject]:
    result = await db.scalars(
        select(ChatProject)
        .where(ChatProject.user_id == current_user.id)
        .order_by(ChatProject.is_pinned.desc(), ChatProject.updated_at.desc())
    )
    return list(result)


@router.patch("/projects/{project_id}", response_model=ChatProjectResponse)
async def update_project(
    project_id: uuid.UUID,
    payload: ChatProjectUpdate,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> ChatProject:
    project = await owned_project(project_id, current_user, db)
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="프로젝트 이름을 입력해 주세요.",
            )
        project.name = name
    if "parent_id" in payload.model_fields_set:
        if payload.parent_id == project.id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="프로젝트를 자기 자신의 하위 프로젝트로 이동할 수 없습니다.",
            )
        candidate = (
            await owned_project(payload.parent_id, current_user, db)
            if payload.parent_id is not None
            else None
        )
        visited = {project.id}
        while candidate is not None:
            if candidate.id in visited:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="프로젝트 계층을 순환하도록 이동할 수 없습니다.",
                )
            visited.add(candidate.id)
            candidate = (
                await owned_project(candidate.parent_id, current_user, db)
                if candidate.parent_id is not None
                else None
            )
        project.parent_id = payload.parent_id
    if payload.is_pinned is not None:
        project.is_pinned = payload.is_pinned
    project.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> Response:
    project = await owned_project(project_id, current_user, db)
    await db.execute(
        update(ChatProject)
        .where(
            ChatProject.parent_id == project.id,
            ChatProject.user_id == current_user.id,
        )
        .values(parent_id=project.parent_id)
    )
    await db.execute(
        update(ChatSession)
        .where(
            ChatSession.project_id == project.id,
            ChatSession.user_id == current_user.id,
        )
        .values(project_id=project.parent_id)
    )
    await db.delete(project)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/transcriptions", response_model=TranscriptionResponse)
async def create_transcription(
    current_user: CurrentUser,
    file: Annotated[UploadFile, File()],
) -> TranscriptionResponse:
    del current_user
    content_type = (file.content_type or "").split(";", 1)[0].lower()
    if content_type not in ALLOWED_AUDIO_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="지원하지 않는 음성 파일 형식입니다.",
        )

    content = await file.read(settings.voice_upload_max_bytes + 1)
    filename = file.filename or "recording.webm"
    await file.close()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="녹음된 음성이 없습니다.",
        )
    if len(content) > settings.voice_upload_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="음성 파일 크기가 제한을 초과했습니다.",
        )
    try:
        text = await transcribe_audio(
            filename=filename,
            content_type=content_type,
            content=content,
        )
    except TranscriptionNotConfiguredError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
    except TranscriptionError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(error),
        ) from error
    return TranscriptionResponse(text=text)


@router.post(
    "/attachments",
    response_model=ChatAttachmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_attachment(
    current_user: CurrentUser,
    db: DatabaseSession,
    kind: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
) -> ChatAttachmentResponse:
    if kind not in {"image", "file"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="첨부 종류는 image 또는 file이어야 합니다.",
        )
    try:
        attachment = await save_upload(file, kind, current_user.id)
    except AttachmentValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error
    db.add(attachment)
    try:
        await db.commit()
    except Exception:
        await remove_stored_file(attachment)
        raise
    await db.refresh(attachment)
    return ChatAttachmentResponse.model_validate(attachment)


@router.get("/attachments/{attachment_id}/content", response_class=FileResponse)
async def attachment_content(
    attachment_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession
) -> FileResponse:
    attachment = await db.scalar(
        select(ChatAttachment).where(
            ChatAttachment.id == attachment_id,
            ChatAttachment.user_id == current_user.id,
        )
    )
    if attachment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="파일을 찾을 수 없습니다."
        )
    path = attachment_path(attachment.storage_name)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="파일을 찾을 수 없습니다."
        )
    return FileResponse(
        path,
        filename=attachment.original_filename,
        media_type=attachment.content_type,
        content_disposition_type="inline" if attachment.kind == "image" else "attachment",
    )


@router.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pending_attachment(
    attachment_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession
) -> Response:
    attachment = await db.scalar(
        select(ChatAttachment).where(
            ChatAttachment.id == attachment_id,
            ChatAttachment.user_id == current_user.id,
            ChatAttachment.message_id.is_(None),
        )
    )
    if attachment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="파일을 찾을 수 없습니다."
        )
    await remove_stored_file(attachment)
    await db.delete(attachment)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/guest/generate/stream", response_class=StreamingResponse)
async def stream_guest_response(
    messages_json: Annotated[str, Form()],
    kinds_json: Annotated[str, Form()] = "[]",
    resume_from: Annotated[str | None, Form()] = None,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> StreamingResponse:
    uploaded_files = files or []
    try:
        raw_messages = json.loads(messages_json)
        attachment_kinds = json.loads(kinds_json)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="임시 대화 데이터가 올바르지 않습니다.",
        ) from error

    if not isinstance(raw_messages, list) or not raw_messages:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="질문을 입력해 주세요.",
        )
    if not isinstance(attachment_kinds, list) or any(
        kind not in {"image", "file"} for kind in attachment_kinds
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="첨부파일 정보가 올바르지 않습니다.",
        )
    if len(uploaded_files) != len(attachment_kinds):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="첨부파일 정보가 일치하지 않습니다.",
        )
    if len(uploaded_files) > settings.upload_max_attachments_per_message:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"첨부파일은 메시지당 최대 {settings.upload_max_attachments_per_message}개입니다.",
        )

    messages: list[GuestCompletionMessage] = []
    previous_role: str | None = None
    user_turns = 0
    total_characters = 0
    for raw_message in raw_messages:
        if not isinstance(raw_message, dict):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="임시 대화 데이터가 올바르지 않습니다.",
            )
        role = raw_message.get("role")
        content = raw_message.get("content")
        is_interrupted = raw_message.get("is_interrupted", False)
        if (
            role not in {"user", "assistant"}
            or (not messages and role != "user")
            or (role == "assistant" and previous_role == "assistant")
            or not isinstance(content, str)
            or not isinstance(is_interrupted, bool)
            or (is_interrupted and role != "assistant")
            or len(content) > 12_000
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="임시 대화 순서 또는 길이가 올바르지 않습니다.",
            )
        total_characters += len(content)
        if total_characters > 48_000:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="임시 대화가 너무 깁니다. 로그인 후 계속해 주세요.",
            )
        if role == "user":
            user_turns += 1
        previous_role = role
        messages.append(GuestCompletionMessage(
            role=role,
            content=content,
            attachments=[],
            is_interrupted=is_interrupted,
        ))

    if messages[-1].role != "user":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="답변을 생성할 새 질문이 없습니다.",
        )
    if user_turns > GUEST_CHAT_MAX_TURNS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비로그인 체험은 3번까지 가능합니다. 로그인 후 계속해 주세요.",
        )
    if not messages[-1].content.strip() and not uploaded_files:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="질문을 입력해 주세요.",
        )

    guest_id = uuid.uuid4()
    temporary_attachments: list[ChatAttachment] = []
    try:
        for upload, kind in zip(uploaded_files, attachment_kinds, strict=True):
            temporary_attachments.append(await save_upload(upload, kind, guest_id))
    except AttachmentValidationError as error:
        for attachment in temporary_attachments:
            await remove_stored_file(attachment)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error
    messages[-1].attachments = temporary_attachments
    resume_prefix = resume_from.strip() if resume_from else ""
    if resume_prefix:
        messages.extend([
            GuestCompletionMessage(
                role="assistant",
                content=resume_prefix,
                attachments=[],
                is_interrupted=True,
            ),
            GuestCompletionMessage(
                role="user",
                content=RESUME_GENERATION_PROMPT,
                attachments=[],
            ),
        ])

    async def events() -> AsyncIterator[str]:
        chunks: list[str] = []
        output_id = uuid.uuid4()
        try:
            yield stream_event("start", {"input_message_id": str(uuid.uuid4())})
            async for chunk in stream_chat_completion(messages):  # type: ignore[arg-type]
                chunks.append(chunk)
                yield stream_event("delta", {"content": chunk})
            continuation = "".join(chunks).strip()
            content = f"{resume_prefix}{continuation}".strip()
            if not content:
                raise ChatAPIError("Chat API 스트림 응답 내용이 비어 있습니다.")
            yield stream_event(
                "complete",
                {
                    "output": {
                        "id": str(output_id),
                        "user_id": "guest",
                        "session_id": "guest-session",
                        "role": "assistant",
                        "content": content,
                        "created_at": datetime.now(UTC).isoformat(),
                        "attachments": [],
                    }
                },
            )
        except (ChatAPINotConfiguredError, ChatAPIError) as error:
            yield stream_event("error", {"detail": str(error)})
        except Exception:
            logger.exception("Unexpected guest chat generation failure.")
            yield stream_event("error", {"detail": "답변 스트리밍 중 오류가 발생했습니다."})
        finally:
            for attachment in temporary_attachments:
                await remove_stored_file(attachment)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/sessions", response_model=ChatSessionDetail, status_code=status.HTTP_201_CREATED)
async def create_session(
    payload: ChatInput, current_user: CurrentUser, db: DatabaseSession
) -> ChatSessionDetail:
    content = payload.input.strip()
    attachments = await pending_attachments(payload.attachment_ids, current_user, db)
    if not content and not attachments:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="질문을 입력해 주세요.",
        )

    if payload.project_id is not None:
        await owned_project(payload.project_id, current_user, db)
    title = content[:120] if content else attachments[0].original_filename[:120]
    session = ChatSession(
        user_id=current_user.id,
        project_id=payload.project_id,
        title=title,
    )
    db.add(session)
    await db.flush()
    message = ChatMessage(
        session_id=session.id,
        user_id=current_user.id,
        role="user",
        content=content,
    )
    db.add(message)
    await db.flush()
    for attachment in attachments:
        attachment.message_id = message.id
    await db.commit()
    await db.refresh(session)
    await db.refresh(message)
    return ChatSessionDetail(
        id=session.id,
        user_id=session.user_id,
        project_id=session.project_id,
        title=session.title,
        is_pinned=session.is_pinned,
        created_at=session.created_at,
        updated_at=session.updated_at,
        messages=[message_response(message, attachments)],
    )


@router.get("/sessions", response_model=list[ChatSessionSummary])
async def list_sessions(current_user: CurrentUser, db: DatabaseSession) -> list[ChatSessionSummary]:
    result = await db.scalars(
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.is_pinned.desc(), ChatSession.updated_at.desc())
        .limit(100)
    )
    return [ChatSessionSummary.model_validate(session) for session in result]


@router.patch("/sessions/{session_id}", response_model=ChatSessionSummary)
async def update_session(
    session_id: uuid.UUID,
    payload: ChatSessionUpdate,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> ChatSession:
    session = await owned_session(session_id, current_user, db)
    if payload.title is not None:
        session.title = payload.title.strip()
    if payload.is_pinned is not None:
        session.is_pinned = payload.is_pinned
    if "project_id" in payload.model_fields_set:
        if payload.project_id is not None:
            await owned_project(payload.project_id, current_user, db)
        session.project_id = payload.project_id
    session.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> Response:
    session = await owned_session(session_id, current_user, db)
    attachments = list(
        await db.scalars(
            select(ChatAttachment)
            .join(ChatMessage, ChatAttachment.message_id == ChatMessage.id)
            .where(ChatMessage.session_id == session.id)
        )
    )
    for attachment in attachments:
        await remove_stored_file(attachment)
    await db.delete(session)
    await db.commit()
    try:
        await delete_session_memory(session.id)
    except MemoryServiceError:
        logger.exception("Deleted chat memory could not be removed from Qdrant.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sessions/{session_id}", response_model=ChatSessionDetail)
async def get_session(
    session_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession
) -> ChatSessionDetail:
    session = await owned_session(session_id, current_user, db)
    return detail_response(session, await session_messages(session_id, db))


@router.post(
    "/sessions/{session_id}/messages",
    response_model=ChatMessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_user_message(
    session_id: uuid.UUID,
    payload: ChatInput,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> ChatMessageResponse:
    session = await owned_session(session_id, current_user, db)
    content = payload.input.strip()
    attachments = await pending_attachments(payload.attachment_ids, current_user, db)
    if not content and not attachments:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="질문을 입력해 주세요.",
        )

    message = ChatMessage(
        session_id=session.id,
        user_id=current_user.id,
        role="user",
        content=content,
    )
    db.add(message)
    await db.flush()
    for attachment in attachments:
        attachment.message_id = message.id
    session.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(message)
    return message_response(message, attachments)


@router.post(
    "/sessions/{session_id}/messages/interrupted",
    response_model=ChatMessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def save_interrupted_output(
    session_id: uuid.UUID,
    payload: ChatInterruptedOutput,
    current_user: CurrentUser,
    db: DatabaseSession,
) -> ChatMessageResponse:
    session = await owned_session(session_id, current_user, db)
    messages = await session_messages(session_id, db)
    if not messages or messages[-1].role != "user":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="중단된 답변을 연결할 사용자 메시지가 없습니다.",
        )
    content = payload.output.strip()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="저장할 답변 내용이 없습니다.",
        )

    output = ChatMessage(
        session_id=session.id,
        user_id=current_user.id,
        role="assistant",
        content=content,
        is_interrupted=True,
        generation_duration_ms=payload.generation_duration_ms,
    )
    session.updated_at = datetime.now(UTC)
    db.add(output)
    await db.commit()
    await db.refresh(output)
    try:
        await index_turns([ChatTurn(user=messages[-1], assistant=output)])
    except MemoryServiceError:
        logger.exception("The interrupted chat turn could not be indexed in Qdrant.")
    return message_response(output, [])


@router.post("/sessions/{session_id}/generate", response_model=ChatGenerationResponse)
async def generate_response(
    session_id: uuid.UUID, current_user: CurrentUser, db: DatabaseSession
) -> ChatGenerationResponse:
    session = await owned_session(session_id, current_user, db)
    messages = await session_messages(session_id, db)
    if not messages or messages[-1].role != "user":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="답변을 생성할 새 사용자 메시지가 없습니다.",
        )

    context = await generation_context(messages)
    generation_started = perf_counter()
    try:
        completion = await create_chat_completion(context)
    except ChatAPINotConfiguredError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
    except ChatAPIError as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error

    output = ChatMessage(
        session_id=session.id,
        user_id=current_user.id,
        role=completion.role,
        content=completion.content,
        generation_duration_ms=max(0, round((perf_counter() - generation_started) * 1000)),
    )
    if len(messages) == 1:
        try:
            session.title = await create_chat_title(messages[-1].content, completion.content)
        except ChatAPIError:
            logger.exception("The first chat turn could not be summarized as a title.")
    session.updated_at = datetime.now(UTC)
    db.add(output)
    await db.commit()
    await db.refresh(output)
    try:
        await index_turns([ChatTurn(user=messages[-1], assistant=output)])
    except MemoryServiceError:
        logger.exception("The completed chat turn could not be indexed in Qdrant.")
    return ChatGenerationResponse(
        session_id=session.id,
        session_title=session.title,
        input=message_response(messages[-1]),
        output=message_response(output, []),
    )


@router.post("/sessions/{session_id}/generate/stream", response_class=StreamingResponse)
async def stream_response(
    session_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser,
    db: DatabaseSession,
    payload: ChatGenerationControl | None = None,
) -> StreamingResponse:
    session = await owned_session(session_id, current_user, db)
    messages = await session_messages(session_id, db)
    if not messages or messages[-1].role != "user":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="답변을 생성할 새 사용자 메시지가 없습니다.",
        )
    context = await generation_context(messages)
    input_message = messages[-1]
    resume_prefix = payload.resume_from.strip() if payload and payload.resume_from else ""
    elapsed_ms = payload.elapsed_ms if payload else 0
    if resume_prefix:
        interrupted = ChatMessage(
            session_id=session.id,
            user_id=current_user.id,
            role="assistant",
            content=resume_prefix,
            is_interrupted=True,
        )
        interrupted.attachments = []
        continuation_request = ChatMessage(
            session_id=session.id,
            user_id=current_user.id,
            role="user",
            content=RESUME_GENERATION_PROMPT,
        )
        continuation_request.attachments = []
        context = [*context, interrupted, continuation_request]

    async def events() -> AsyncIterator[str]:
        chunks: list[str] = []
        segment_started = perf_counter()
        yield stream_event(
            "start",
            {"session_id": str(session.id), "input_message_id": str(input_message.id)},
        )
        try:
            async for chunk in stream_chat_completion(context):
                chunks.append(chunk)
                yield stream_event("delta", {"content": chunk})

            continuation = "".join(chunks).strip()
            content = f"{resume_prefix}{continuation}".strip()
            if not content:
                raise ChatAPIError("Chat API 스트림 응답 내용이 비어 있습니다.")
            if await request.is_disconnected():
                await db.rollback()
                return
            output = ChatMessage(
                session_id=session.id,
                user_id=current_user.id,
                role="assistant",
                content=content,
                generation_duration_ms=elapsed_ms + max(
                    0, round((perf_counter() - segment_started) * 1000)
                ),
            )
            if len(messages) == 1:
                try:
                    session.title = await create_chat_title(input_message.content, content)
                except ChatAPIError:
                    logger.exception("The first streamed turn could not be summarized as a title.")
            session.updated_at = datetime.now(UTC)
            db.add(output)
            await db.commit()
            await db.refresh(output)
            try:
                await index_turns([ChatTurn(user=input_message, assistant=output)])
            except MemoryServiceError:
                logger.exception("The streamed chat turn could not be indexed in Qdrant.")
            yield stream_event(
                "complete",
                {
                    "output": message_response(output, []).model_dump(mode="json"),
                    "session_title": session.title,
                },
            )
        except (ChatAPINotConfiguredError, ChatAPIError) as error:
            await db.rollback()
            yield stream_event("error", {"detail": str(error)})
        except Exception:
            await db.rollback()
            logger.exception("Unexpected streamed chat generation failure.")
            yield stream_event("error", {"detail": "답변 스트리밍 중 오류가 발생했습니다."})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
