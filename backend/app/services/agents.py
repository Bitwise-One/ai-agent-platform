"""Agent 服务：应用内的智能体配置与其知识库绑定。"""

from __future__ import annotations

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.models import Agent, AgentKb, KnowledgeBase, ModelConfig
from app.models.base import utcnow
from app.schemas.agent import AgentCreate, AgentUpdate


async def create_agent(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, payload: AgentCreate
) -> Agent:
    """创建 Agent。

    若标记为默认 Agent，则把同应用下其它 Agent 的 is_default 置否，
    保证「一个应用至多一个默认 Agent」这条不变量。
    若指定了 model_config_id，先校验该模型归属本租户，避免跨租户引用。
    """
    if payload.is_default:
        await _clear_default(session, tenant_id, app_id)
    if payload.model_config_id is not None:
        await _ensure_model_owned(session, tenant_id, payload.model_config_id)

    agent = Agent(
        tenant_id=tenant_id,
        application_id=app_id,
        name=payload.name,
        system_prompt=payload.system_prompt,
        model_config_id=payload.model_config_id,
        temperature=payload.temperature,
        max_context_len=payload.max_context_len,
        memory_strategy=payload.memory_strategy,
        keywords=payload.keywords,
        is_default=payload.is_default,
    )
    session.add(agent)
    await session.flush()
    return agent


async def _ensure_model_owned(
    session: AsyncSession, tenant_id: uuid.UUID, model_config_id: uuid.UUID
) -> None:
    """校验模型配置属于本租户。

    不校验的后果：租户 A 可以把自己的 Agent 指向租户 B 的模型 ID，
    在按租户计费/限流的场景下会被用来蹭额度。
    """
    owned = await session.scalar(
        select(ModelConfig.id).where(
            ModelConfig.id == model_config_id, ModelConfig.tenant_id == tenant_id
        )
    )
    if owned is None:
        raise NotFound("模型配置不存在或不可用")


async def _clear_default(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID
) -> None:
    rows = await session.scalars(
        select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.application_id == app_id,
            Agent.is_default.is_(True),
        )
    )
    for row in rows:
        row.is_default = False


async def list_agents(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID
) -> list[Agent]:
    rows = await session.scalars(
        select(Agent)
        .where(
            Agent.tenant_id == tenant_id,
            Agent.application_id == app_id,
            Agent.deleted_at.is_(None),
        )
        .order_by(Agent.created_at.asc())
    )
    return list(rows)


async def get_agent(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, agent_id: uuid.UUID
) -> Agent:
    agent = await session.scalar(
        select(Agent).where(
            Agent.id == agent_id,
            Agent.tenant_id == tenant_id,
            Agent.application_id == app_id,
            Agent.deleted_at.is_(None),
        )
    )
    if agent is None:
        raise NotFound("Agent 不存在")
    return agent


async def update_agent(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    agent_id: uuid.UUID,
    payload: AgentUpdate,
) -> Agent:
    agent = await get_agent(session, tenant_id, app_id, agent_id)
    data = payload.model_dump(exclude_unset=True)

    if data.get("is_default") is True:
        await _clear_default(session, tenant_id, app_id)
    if data.get("model_config_id") is not None:
        await _ensure_model_owned(session, tenant_id, data["model_config_id"])

    for key, value in data.items():
        setattr(agent, key, value)
    await session.flush()
    return agent


async def delete_agent(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, agent_id: uuid.UUID
) -> None:
    agent = await get_agent(session, tenant_id, app_id, agent_id)
    if agent.is_default:
        raise Conflict("默认兜底 Agent 不能删除，请先将其他 Agent 设为默认")
    agent.deleted_at = utcnow()
    # 解绑知识库，避免悬挂引用
    await session.execute(delete(AgentKb).where(AgentKb.agent_id == agent_id))
    await session.flush()


# ------------------------------------------------------------ 知识库绑定
async def bind_knowledge_bases(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    agent_id: uuid.UUID,
    kb_ids: list[uuid.UUID],
) -> list[uuid.UUID]:
    """覆盖式绑定：先校验 kb 属于本租户，再整体替换绑定关系。"""
    await get_agent(session, tenant_id, app_id, agent_id)

    if kb_ids:
        valid = set(
            (
                await session.scalars(
                    select(KnowledgeBase.id).where(
                        KnowledgeBase.id.in_(kb_ids),
                        KnowledgeBase.tenant_id == tenant_id,
                        KnowledgeBase.deleted_at.is_(None),
                    )
                )
            ).all()
        )
        missing = [str(k) for k in kb_ids if k not in valid]
        if missing:
            raise NotFound(f"知识库不存在或不可用: {', '.join(missing)}")

    await session.execute(delete(AgentKb).where(AgentKb.agent_id == agent_id))
    for kb_id in kb_ids:
        session.add(AgentKb(agent_id=agent_id, kb_id=kb_id))
    await session.flush()
    return kb_ids


async def get_kb_ids(session: AsyncSession, agent_id: uuid.UUID) -> list[uuid.UUID]:
    """查询某 Agent 绑定的知识库 ID 列表（供 RAG 检索使用）。"""
    rows = await session.scalars(select(AgentKb.kb_id).where(AgentKb.agent_id == agent_id))
    return list(rows)


async def count_agents(session: AsyncSession, tenant_id: uuid.UUID) -> int:
    return (
        await session.scalar(
            select(func.count()).select_from(Agent).where(Agent.tenant_id == tenant_id)
        )
        or 0
    )
