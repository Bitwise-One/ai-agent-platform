"""模型配置服务：租户级模型目录、加密凭据与连通性探测。

与其他服务的差别：
- API Key 仅通过 Fernet 加密列保存；API 只返回配置状态，运行时只在内存解密。
- 探测（`probe`）会真的打一次网关，用来回答「这个模型名在当前部署下能不能用」。
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import ipaddress
import time
import uuid
from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, NotFound
from app.gateway import get_gateway
from app.gateway.openai_compat import OpenAICompatLLM
from app.models import Agent, ModelConfig
from app.schemas.model import ModelConfigCreate, ModelConfigUpdate, ModelProbeResult


async def create_model_config(
    session: AsyncSession, tenant_id: uuid.UUID, payload: ModelConfigCreate
) -> ModelConfig:
    """新建模型配置。同名模型允许重复（不同单价方案），因此不做唯一约束。"""
    record = ModelConfig(
        tenant_id=tenant_id,
        name=payload.name,
        provider=payload.provider,
        model_name=payload.model_name,
        base_url=await validate_base_url(payload.base_url),
        context_len=payload.context_len,
        price_in=payload.price_in,
        price_out=payload.price_out,
        capabilities=payload.capabilities,
        status=payload.status,
    )
    session.add(record)
    await session.flush()
    return record


async def list_model_configs(session: AsyncSession, tenant_id: uuid.UUID) -> list[ModelConfig]:
    rows = await session.scalars(
        select(ModelConfig)
        .where(ModelConfig.tenant_id == tenant_id)
        .order_by(ModelConfig.created_at.asc())
    )
    return list(rows)


async def get_model_config(
    session: AsyncSession, tenant_id: uuid.UUID, config_id: uuid.UUID
) -> ModelConfig:
    """按租户取单条；跨租户一律 404，不暴露「该 ID 是否存在」。"""
    record = await session.scalar(
        select(ModelConfig).where(
            ModelConfig.id == config_id, ModelConfig.tenant_id == tenant_id
        )
    )
    if record is None:
        raise NotFound("模型配置不存在")
    return record


async def update_model_config(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    config_id: uuid.UUID,
    payload: ModelConfigUpdate,
) -> ModelConfig:
    record = await get_model_config(session, tenant_id, config_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "base_url":
            value = await validate_base_url(value)
        setattr(record, key, value)
    await session.flush()
    return record


async def delete_model_config(
    session: AsyncSession, tenant_id: uuid.UUID, config_id: uuid.UUID
) -> None:
    """物理删除。

    model_config 没有被软删除 mixin，且 Agent 对它是可空外键（置空即可存活），
    因此这里直接删；若仍有 Agent 引用，外键约束会拦下（应用层先解绑更友好）。
    """
    record = await get_model_config(session, tenant_id, config_id)
    references = await session.scalar(
        select(func.count()).select_from(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.model_config_id == config_id,
            Agent.deleted_at.is_(None),
        )
    ) or 0
    if references:
        raise AppError(10009, f"该模型仍被 {references} 个 Agent 使用，请先重新绑定模型", 409)
    await session.delete(record)
    await session.flush()


async def resolve_model_names(
    session: AsyncSession, tenant_id: uuid.UUID, config_ids: list[uuid.UUID]
) -> dict[str, str]:
    """把 model_config_id 映射成厂商模型名。

    图执行只认识模型名（`gpt-4o-mini` 这类），不认数据库主键，
    因此在组装 WorkflowSpec 时一次性查出映射，避免节点里逐次查库。
    """
    ids = [i for i in config_ids if i]
    if not ids:
        return {}
    rows = await session.scalars(
        select(ModelConfig).where(
            ModelConfig.tenant_id == tenant_id, ModelConfig.id.in_(ids)
        )
    )
    return {str(r.id): r.model_name for r in rows}


async def validate_base_url(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    value = value.strip().rstrip("/")
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise AppError(10001, "模型 API 地址必须为不含凭据的 HTTPS URL", 422)
    if parsed.hostname.endswith(".local"):
        raise AppError(10003, "模型 API 地址不能指向本地域名", 422)
    try:
        addresses = await asyncio.get_running_loop().getaddrinfo(parsed.hostname, parsed.port or 443)
    except OSError as exc:
        raise AppError(10001, "模型 API 域名无法解析", 422) from exc
    for address in addresses:
        if not ipaddress.ip_address(address[4][0]).is_global:
            raise AppError(10003, "模型 API 地址不能指向本机、私网或保留地址", 422)
    return value


def _credential_cipher() -> Fernet:
    configured = get_settings().credential_encryption_key
    if len(configured) < 32:
        raise AppError(10003, "尚未配置 CREDENTIAL_ENCRYPTION_KEY，拒绝保存模型凭据", 503)
    key = base64.urlsafe_b64encode(hashlib.sha256(configured.encode("utf-8")).digest())
    return Fernet(key)


async def set_model_credential(
    session: AsyncSession, tenant_id: uuid.UUID, config_id: uuid.UUID, api_key: str | None
) -> bool:
    record = await get_model_config(session, tenant_id, config_id)
    if api_key and not record.base_url and not get_settings().llm_base_url:
        raise AppError(10001, "未配置部署级模型地址时，请先填写此模型的 HTTPS API 地址", 422)
    record.api_key_encrypted = _credential_cipher().encrypt(api_key.encode()).decode() if api_key else None
    await session.flush()
    return record.api_key_configured


def decrypt_model_credential(record: ModelConfig) -> str | None:
    if not record.api_key_encrypted:
        return None
    try:
        return _credential_cipher().decrypt(record.api_key_encrypted.encode()).decode()
    except (InvalidToken, UnicodeDecodeError) as exc:
        raise AppError(10003, "模型凭据无法解密，请重新设置", 503) from exc


async def resolve_model_runtime(
    session: AsyncSession, tenant_id: uuid.UUID, config_ids: list[uuid.UUID]
) -> dict[str, dict[str, str | None]]:
    ids = [item for item in config_ids if item]
    if not ids:
        return {}
    rows = await session.scalars(select(ModelConfig).where(ModelConfig.tenant_id == tenant_id, ModelConfig.id.in_(ids)))
    runtime: dict[str, dict[str, str | None]] = {}
    for row in rows:
        runtime[str(row.id)] = {
            "model": row.model_name,
            "base_url": await validate_base_url(row.base_url),
            "api_key": decrypt_model_credential(row),
        }
    return runtime


async def probe(
    session: AsyncSession, tenant_id: uuid.UUID, config_id: uuid.UUID
) -> ModelProbeResult:
    """连通性探测：用该模型名发一条极短请求，观察是否拿到回复。

    设计取舍：
    - 走网关而不是直连厂商，这样探测结果与真实对话链路的降级行为一致；
    - 用 `ready` 字段区分「没配密钥所以走 mock」与「真的调通了」，
      避免运维误判为凭据失效。
    """
    record = await get_model_config(session, tenant_id, config_id)
    gateway = get_gateway()

    started = time.perf_counter()
    detail: str | None = None
    ok = False
    sample = ""
    api_key: str | None = None
    try:
        safe_base_url = await validate_base_url(record.base_url)
        api_key = decrypt_model_credential(record)
        settings = get_settings()
        resolved_base_url = safe_base_url or settings.llm_base_url
        resolved_api_key = api_key or settings.llm_api_key
        if resolved_base_url and resolved_api_key:
            provider = OpenAICompatLLM(
                base_url=resolved_base_url,
                api_key=resolved_api_key,
                default_model=record.model_name,
                timeout_s=settings.llm_timeout_s,
            )
            resp = await provider.complete([{"role": "user", "content": "ping"}], model=record.model_name, temperature=0.0, max_tokens=16)
        else:
            resp = await gateway.complete(
                [{"role": "user", "content": "ping"}],
                model=record.model_name,
                temperature=0.0,
                max_tokens=16,
            )
        sample = (resp.text or "").strip()[:120]
        ok = bool(sample)
    except Exception as exc:  # noqa: BLE001 - 探测失败要作为结果返回，不能 500
        detail = f"{exc.__class__.__name__}: {exc}"[:300]

    latency_ms = int((time.perf_counter() - started) * 1000)
    return ModelProbeResult(
        model_config_id=record.id,
        model_name=record.model_name,
        ready=bool((safe_base_url or get_settings().llm_base_url) and (api_key or get_settings().llm_api_key)),
        ok=ok,
        latency_ms=latency_ms,
        sample=sample,
        detail=detail,
    )
