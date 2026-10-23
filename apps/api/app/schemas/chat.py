import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field


class ChatInput(BaseModel):
    input: str = Field(default="", max_length=12_000)
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=5)
    project_id: uuid.UUID | None = None


class ChatInterruptedOutput(BaseModel):
    output: str = Field(min_length=1, max_length=48_000)


class ChatGenerationControl(BaseModel):
    resume_from: str | None = Field(default=None, min_length=1, max_length=48_000)


class ChatProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    parent_id: uuid.UUID | None = None


class ChatProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    parent_id: uuid.UUID | None = None
    is_pinned: bool | None = None


class ChatProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    is_pinned: bool
    created_at: datetime
    updated_at: datetime


class ChatSessionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    project_id: uuid.UUID | None = None
    is_pinned: bool | None = None


class TranscriptionResponse(BaseModel):
    text: str


class ChatAttachmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: Literal["image", "file"]
    original_filename: str
    content_type: str
    size_bytes: int
    created_at: datetime

    @computed_field
    @property
    def content_url(self) -> str:
        return f"/api/v1/chat/attachments/{self.id}/content"


class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    session_id: uuid.UUID
    role: Literal["user", "assistant", "system"]
    content: str
    is_interrupted: bool = False
    created_at: datetime
    attachments: list[ChatAttachmentResponse] = Field(default_factory=list)


class ChatSessionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    project_id: uuid.UUID | None
    title: str
    is_pinned: bool
    created_at: datetime
    updated_at: datetime


class ChatSessionDetail(ChatSessionSummary):
    messages: list[ChatMessageResponse]


class ChatGenerationResponse(BaseModel):
    session_id: uuid.UUID
    session_title: str
    input: ChatMessageResponse
    output: ChatMessageResponse
