"""模型配置的请求/响应模型。

为什么要单独一套 schema 而不是复用 ORM：
- `price_in` / `price_out` 在库里是 Numeric(12,6)，出参统一转成 float，
  避免前端拿到 Decimal 序列化后变成字符串；
- `capabilities` 是自由 JSON（是否支持 function call / vision / json mode），
  用 dict 承载，方便后续加能力位而不改表结构。
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_SECRET_FIELDS = {"api_key", "authorization", "password", "secret", "token", "credential"}


def _reject_inline_model_secrets(value: dict) -> dict:
    def visit(item):
        if isinstance(item, dict):
            for key, child in item.items():
                if isinstance(key, str) and key.casefold() in _SECRET_FIELDS:
                    raise ValueError("凭据必须通过 write-only 模型密钥接口设置，不能放入 capabilities")
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)
    visit(value)
    return value


class ModelConfigCreate(BaseModel):
    """新建模型配置。

    API Key 通过独立 write-only 凭据接口设置，不在模型 CRUD 响应中出现。
    """

    name: str = Field(min_length=1, max_length=128, description="控制台展示名")
    provider: str = Field(default="openai_compat", max_length=32, description="协议适配器")
    model_name: str = Field(min_length=1, max_length=128, description="厂商侧的模型 ID")
    base_url: str | None = Field(default=None, max_length=512, description="OpenAI 兼容 API 地址")
    context_len: int | None = Field(default=None, ge=512, le=2_000_000)
    price_in: float | None = Field(default=None, ge=0, description="每 1K 输入 token 单价")
    price_out: float | None = Field(default=None, ge=0, description="每 1K 输出 token 单价")
    capabilities: dict = Field(default_factory=dict)
    status: str = Field(default="active")

    @field_validator("capabilities")
    @classmethod
    def reject_inline_secrets(cls, value: dict) -> dict:
        return _reject_inline_model_secrets(value)


class ModelConfigUpdate(BaseModel):
    """局部更新：只改传入的字段。"""

    name: str | None = Field(default=None, min_length=1, max_length=128)
    provider: str | None = Field(default=None, max_length=32)
    model_name: str | None = Field(default=None, min_length=1, max_length=128)
    base_url: str | None = Field(default=None, max_length=512)
    context_len: int | None = Field(default=None, ge=512, le=2_000_000)
    price_in: float | None = Field(default=None, ge=0)
    price_out: float | None = Field(default=None, ge=0)
    capabilities: dict | None = None
    status: str | None = None

    @field_validator("capabilities")
    @classmethod
    def reject_inline_secrets(cls, value: dict | None) -> dict | None:
        return _reject_inline_model_secrets(value) if value is not None else None


class ModelConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    provider: str
    model_name: str
    base_url: str | None = None
    context_len: int | None
    price_in: float | None
    price_out: float | None
    capabilities: dict
    status: str
    created_at: datetime
    api_key_configured: bool = False


class ModelProbeResult(BaseModel):
    """连通性探测结果。

    `ready=False` 不代表配置写错，而是「当前部署没有接入真实模型」——
    网关会回落到 mock，此时探测只能验证路由链路通，不能验证凭据有效。
    """

    model_config_id: uuid.UUID
    model_name: str
    ready: bool = Field(description="网关是否已接入真实 LLM")
    ok: bool = Field(description="本次探测是否拿到非空回复")
    latency_ms: int
    sample: str = ""
    detail: str | None = None


class ModelCredentialWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: str | None = Field(default=None, min_length=1, max_length=4096)
    action: Literal["set", "clear"] = "set"

    @model_validator(mode="after")
    def validate_action(self):
        if self.action == "set" and not self.api_key:
            raise ValueError("设置凭据时 API Key 不能为空")
        return self
