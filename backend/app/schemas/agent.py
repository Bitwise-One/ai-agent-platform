"""Agent 的请求/响应模型。"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    system_prompt: str = Field(default="", max_length=20000)
    # 引用租户级模型配置；为空则走网关默认模型（环境变量 LLM_MODEL）
    model_config_id: uuid.UUID | None = None
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_context_len: int = Field(default=8000, ge=512, le=200_000)
    memory_strategy: str = Field(default="sliding_window")
    keywords: list[str] = Field(default_factory=list)
    is_default: bool = False


class AgentUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    system_prompt: str | None = Field(default=None, max_length=20000)
    model_config_id: uuid.UUID | None = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_context_len: int | None = Field(default=None, ge=512, le=200_000)
    memory_strategy: str | None = None
    keywords: list[str] | None = None
    is_default: bool | None = None
    status: str | None = None


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    application_id: uuid.UUID
    name: str
    system_prompt: str
    model_config_id: uuid.UUID | None
    temperature: float
    max_context_len: int
    memory_strategy: str
    keywords: list[str]
    is_default: bool
    status: str
    created_at: datetime


class AgentKbBind(BaseModel):
    """一次覆盖式绑定：传什么就是什么，传空数组表示解绑全部。"""

    kb_ids: list[uuid.UUID] = Field(default_factory=list)
