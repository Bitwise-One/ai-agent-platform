"""MCP 服务与 Skill 的请求/响应模型。"""

import base64
import binascii
import re
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_WASM_MODULE_BYTES = 256 * 1024
_MCP_SECRET_REF = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
_MCP_INLINE_SECRET_KEYS = {"authorization", "headers", "password", "token", "api_key", "client_secret", "secret"}


def _validate_mcp_config(config: dict[str, Any] | None) -> dict[str, Any] | None:
    if config is None:
        return config

    def inspect(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if isinstance(key, str) and key.lower() in _MCP_INLINE_SECRET_KEYS:
                    raise ValueError("MCP 凭据不得明文放入 config，请使用 auth.secret_ref")
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)

    inspect(config)
    auth = config.get("auth")
    if auth is not None:
        if not isinstance(auth, dict) or set(auth) != {"scheme", "secret_ref"}:
            raise ValueError("auth 仅支持 scheme=bearer 与 secret_ref")
        if auth.get("scheme") != "bearer" or not isinstance(auth.get("secret_ref"), str):
            raise ValueError("MCP auth 仅支持 Bearer secret_ref")
        if not _MCP_SECRET_REF.fullmatch(auth["secret_ref"]):
            raise ValueError("secret_ref 只能包含大写字母、数字和下划线，且以字母开头")
    return config


def _validate_wasm_base64(value: str | None) -> str | None:
    if value is None:
        return value
    try:
        module = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("wasm_module_base64 必须是合法 Base64") from exc
    if not module.startswith(b"\x00asm"):
        raise ValueError("技能模块不是有效的 WebAssembly 二进制")
    if len(module) > MAX_WASM_MODULE_BYTES:
        raise ValueError("WebAssembly 模块不能超过 256 KiB")
    return value


class McpServerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    transport: Literal["stdio", "sse", "http"]
    config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("config")
    @classmethod
    def reject_inline_secrets(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _validate_mcp_config(value) or {}


class McpServerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    transport: Literal["stdio", "sse", "http"] | None = None
    config: dict[str, Any] | None = None
    status: Literal["active", "suspended", "deleted"] | None = None

    @field_validator("config")
    @classmethod
    def reject_inline_secrets(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_mcp_config(value)


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


class McpToolCallRequest(BaseModel):
    params: dict[str, Any] = Field(default_factory=dict)


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    instructions: str | None = Field(default=None, max_length=8000)
    wasm_module_base64: str | None = Field(default=None, max_length=350_000)
    params_schema: dict[str, Any] | None = None
    trigger: dict[str, Any] | None = None

    _validate_wasm = field_validator("wasm_module_base64")(_validate_wasm_base64)


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None
    instructions: str | None = Field(default=None, max_length=8000)
    wasm_module_base64: str | None = Field(default=None, max_length=350_000)
    params_schema: dict[str, Any] | None = None
    trigger: dict[str, Any] | None = None

    _validate_wasm = field_validator("wasm_module_base64")(_validate_wasm_base64)


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


class SkillInvokeRequest(BaseModel):
    params: dict[str, Any] = Field(default_factory=dict)
