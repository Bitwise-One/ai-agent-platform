"""模型配置服务：租户级的模型目录管理 + 连通性探测。

与其他服务的差别：
- 这里的记录**不是**运行时凭据，只是「模型清单」——告诉控制台有哪些模型可选、
  Agent 可以用哪个、单价多少。真正的 base_url / api_key 由部署环境注入，
  因此本服务不存在「把密钥读出来」的接口，天然规避泄露面。
- 探测（`probe`）会真的打一次网关，用来回答「这个模型名在当前部署下能不能用」。
"""

from __future__ import annotations

import time
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.gateway import get_gateway
from app.models import ModelConfig
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
    try:
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
        ready=gateway.llm_ready,
        ok=ok,
        latency_ms=latency_ms,
        sample=sample,
        detail=detail,
    )
