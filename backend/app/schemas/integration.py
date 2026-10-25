"""MCP 服务与 Skill 的请求/响应模型。"""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class McpServerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    transport: Literal["stdio", "sse", "http"]
    config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("config")
    @classmethod
    def reject_inline_secrets(cls, value: dict[str, Any]) -> dict[str, Any]:
        forbidden = {"password", "secret", "api_key", "token", "authorization", "headers"}
        if forbidden.intersection(key.lower() for key in value):
            raise ValueError("敏感凭据不得放入 config，请使用 Secret Manager 引用")
        return value


class McpServerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    transport: Literal["stdio", "sse", "http"] | None = None
    config: dict[str, Any] | None = None
    status: Literal["active", "suspended", "deleted"] | None = None

    @field_validator("config")
    @classmethod
    def reject_inline_secrets(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None:
            forbidden = {"password", "secret", "api_key", "token", "authorization", "headers"}
            if forbidden.intersection(key.lower() for key in value):
                raise ValueError("敏感凭据不得放入 config，请使用 Secret Manager 引用")
        return value


class McpServerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    transport: str
    config: dict[str, Any]
    status: str
    created_at: datetime
    updated_at: datetime


class McpToolOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    mcp_id: uuid.UUID
    name: str
    description: str | None
    input_schema: dict[str, Any]
    enabled: bool
    updated_at: datetime


class McpToolBind(BaseModel):
    ids: list[uuid.UUID] = Field(default_factory=list)

    @field_validator("ids")
    @classmethod
    def reject_duplicates(cls, value: list[uuid.UUID]) -> list[uuid.UUID]:
        if len(value) != len(set(value)):
            raise ValueError("ids 不得包含重复值")
        return value


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    instructions: str | None = Field(default=None, max_length=8000)
    params_schema: dict[str, Any] | None = None
    trigger: dict[str, Any] | None = None


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    instructions: str | None = Field(default=None, max_length=8000)
    params_schema: dict[str, Any] | None = None
    trigger: dict[str, Any] | None = None


class SkillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    description: str | None
    instructions: str | None
    params_schema: dict[str, Any] | None
    trigger: dict[str, Any] | None
    source: str
    created_at: datetime
    updated_at: datetime


class IntegrationBind(BaseModel):
    ids: list[uuid.UUID] = Field(default_factory=list)

    @field_validator("ids")
    @classmethod
    def reject_duplicates(cls, value: list[uuid.UUID]) -> list[uuid.UUID]:
        if len(value) != len(set(value)):
            raise ValueError("ids 不得包含重复值")
        return value
