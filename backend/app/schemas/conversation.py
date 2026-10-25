"""会话与消息的请求/响应模型。"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ConversationCreate(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    title: str | None = Field(default=None, max_length=256)
    metadata: dict = Field(default_factory=dict)


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    application_id: uuid.UUID
    user_id: str
    title: str | None
    status: str
    created_at: datetime
    updated_at: datetime


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    conversation_id: uuid.UUID
    role: str
    content: str | None
    created_at: datetime


class HiddenResponseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    action: str
    payload: dict


class ChatRequest(BaseModel):
    """一次对话请求；conversation_id 为空则新建会话。"""

    user_id: str = Field(min_length=1, max_length=128)
    conversation_id: uuid.UUID | None = None
    message: str = Field(min_length=1, max_length=8000)
    idempotency_key: str | None = Field(default=None, max_length=128)
    metadata: dict = Field(default_factory=dict)


class ChatResponse(BaseModel):
    conversation_id: uuid.UUID
    run_id: uuid.UUID
    status: str
    reply: str | None = None
    hidden_responses: list[dict] = Field(default_factory=list)
    token_usage: int = 0
    # RAG 引用来源，供前端展示「答案依据」（FR-K-09）
    rag_sources: list[dict] = Field(default_factory=list)


class HiddenActionConsumeRequest(BaseModel):
    token: str = Field(min_length=32, max_length=4096)
