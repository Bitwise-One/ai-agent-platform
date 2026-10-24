"""模型配置的请求/响应模型。

为什么要单独一套 schema 而不是复用 ORM：
- `price_in` / `price_out` 在库里是 Numeric(12,6)，出参统一转成 float，
  避免前端拿到 Decimal 序列化后变成字符串；
- `capabilities` 是自由 JSON（是否支持 function call / vision / json mode），
  用 dict 承载，方便后续加能力位而不改表结构。
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ModelConfigCreate(BaseModel):
    """新建模型配置。

    注意：这里不接收 api_key / base_url。M2 阶段真实凭据由部署环境的
    环境变量提供（`LLM_API_KEY` 等），模型配置只描述「用哪个模型」；
    租户自带密钥（BYOK）涉及密钥托管与轮换，留到 M3 再做，
    以免明文密钥落库。
    """

    name: str = Field(min_length=1, max_length=128, description="控制台展示名")
    provider: str = Field(default="openai_compat", max_length=32, description="协议适配器")
    model_name: str = Field(min_length=1, max_length=128, description="厂商侧的模型 ID")
    context_len: int | None = Field(default=None, ge=512, le=2_000_000)
    price_in: float | None = Field(default=None, ge=0, description="每 1K 输入 token 单价")
    price_out: float | None = Field(default=None, ge=0, description="每 1K 输出 token 单价")
    capabilities: dict = Field(default_factory=dict)
    status: str = Field(default="active")


class ModelConfigUpdate(BaseModel):
    """局部更新：只改传入的字段。"""

    name: str | None = Field(default=None, min_length=1, max_length=128)
    provider: str | None = Field(default=None, max_length=32)
    model_name: str | None = Field(default=None, min_length=1, max_length=128)
    context_len: int | None = Field(default=None, ge=512, le=2_000_000)
    price_in: float | None = Field(default=None, ge=0)
    price_out: float | None = Field(default=None, ge=0)
    capabilities: dict | None = None
    status: str | None = None


class ModelConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    provider: str
    model_name: str
    context_len: int | None
    price_in: float | None
    price_out: float | None
    capabilities: dict
    status: str
    created_at: datetime


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
