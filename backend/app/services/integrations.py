"""租户级 MCP/Skill 管理及 Agent 绑定。"""

from __future__ import annotations

import uuid
from typing import TypeVar

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.models import Agent, AgentMcp, AgentSkill, McpServer, Skill
from app.schemas.integration import (
    McpServerCreate,
    McpServerUpdate,
    SkillCreate,
    SkillUpdate,
)

T = TypeVar("T", McpServer, Skill)


async def create_mcp(session: AsyncSession, tenant_id: uuid.UUID, payload: McpServerCreate) -> McpServer:
    row = McpServer(tenant_id=tenant_id, name=payload.name, transport=payload.transport, config=payload.config)
    session.add(row)
    await session.flush()
    return row


async def list_mcps(
    session: AsyncSession, tenant_id: uuid.UUID, *, offset: int = 0, limit: int = 20, status: str | None = None
) -> tuple[list[McpServer], int]:
    filters = [McpServer.tenant_id == tenant_id]
    if status:
        filters.append(McpServer.status == status)
    total = await session.scalar(select(func.count()).select_from(McpServer).where(*filters)) or 0
    rows = await session.scalars(
        select(McpServer).where(*filters).order_by(McpServer.created_at.asc()).offset(offset).limit(limit)
    )
    return list(rows), total


async def get_mcp(session: AsyncSession, tenant_id: uuid.UUID, mcp_id: uuid.UUID) -> McpServer:
    row = await session.scalar(select(McpServer).where(McpServer.id == mcp_id, McpServer.tenant_id == tenant_id))
    if row is None:
        raise NotFound("MCP 服务不存在")
    return row


async def update_mcp(session: AsyncSession, tenant_id: uuid.UUID, mcp_id: uuid.UUID, payload: McpServerUpdate) -> McpServer:
    row = await get_mcp(session, tenant_id, mcp_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    await session.flush()
    return row


async def delete_mcp(session: AsyncSession, tenant_id: uuid.UUID, mcp_id: uuid.UUID) -> None:
    row = await get_mcp(session, tenant_id, mcp_id)
    row.status = "deleted"
    await session.flush()


async def create_skill(session: AsyncSession, tenant_id: uuid.UUID, payload: SkillCreate) -> Skill:
    row = Skill(tenant_id=tenant_id, name=payload.name, description=payload.description, params_schema=payload.params_schema, trigger=payload.trigger)
    session.add(row)
    await session.flush()
    return row


async def list_skills(
    session: AsyncSession, tenant_id: uuid.UUID, *, offset: int = 0, limit: int = 20
) -> tuple[list[Skill], int]:
    total = await session.scalar(
        select(func.count()).select_from(Skill).where(Skill.tenant_id == tenant_id)
    ) or 0
    rows = await session.scalars(
        select(Skill).where(Skill.tenant_id == tenant_id).order_by(Skill.created_at.asc()).offset(offset).limit(limit)
    )
    return list(rows), total


async def get_skill(session: AsyncSession, tenant_id: uuid.UUID, skill_id: uuid.UUID) -> Skill:
    row = await session.scalar(select(Skill).where(Skill.id == skill_id, Skill.tenant_id == tenant_id))
    if row is None:
        raise NotFound("Skill 不存在")
    return row


async def update_skill(session: AsyncSession, tenant_id: uuid.UUID, skill_id: uuid.UUID, payload: SkillUpdate) -> Skill:
    row = await get_skill(session, tenant_id, skill_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    await session.flush()
    return row


async def delete_skill(session: AsyncSession, tenant_id: uuid.UUID, skill_id: uuid.UUID) -> None:
    row = await get_skill(session, tenant_id, skill_id)
    await session.delete(row)
    await session.flush()


async def _get_agent(session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, agent_id: uuid.UUID) -> Agent:
    row = await session.scalar(select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id, Agent.application_id == app_id, Agent.deleted_at.is_(None)))
    if row is None:
        raise NotFound("Agent 不存在")
    return row


async def bind_mcp(session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, agent_id: uuid.UUID, ids: list[uuid.UUID]) -> list[uuid.UUID]:
    await _get_agent(session, tenant_id, app_id, agent_id)
    valid = set((await session.scalars(select(McpServer.id).where(McpServer.id.in_(ids), McpServer.tenant_id == tenant_id, McpServer.status != "deleted"))).all()) if ids else set()
    missing = [str(item) for item in ids if item not in valid]
    if missing:
        raise NotFound(f"MCP 服务不存在或不可用: {', '.join(missing)}")
    await session.execute(delete(AgentMcp).where(AgentMcp.agent_id == agent_id))
    for item in ids:
        session.add(AgentMcp(agent_id=agent_id, mcp_id=item))
    await session.flush()
    return ids


async def bind_skill(session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, agent_id: uuid.UUID, ids: list[uuid.UUID]) -> list[uuid.UUID]:
    await _get_agent(session, tenant_id, app_id, agent_id)
    valid = set((await session.scalars(select(Skill.id).where(Skill.id.in_(ids), Skill.tenant_id == tenant_id))).all()) if ids else set()
    missing = [str(item) for item in ids if item not in valid]
    if missing:
        raise NotFound(f"Skill 不存在或不可用: {', '.join(missing)}")
    await session.execute(delete(AgentSkill).where(AgentSkill.agent_id == agent_id))
    for item in ids:
        session.add(AgentSkill(agent_id=agent_id, skill_id=item))
    await session.flush()
    return ids


async def get_binding_ids(session: AsyncSession, agent_id: uuid.UUID, kind: str) -> list[uuid.UUID]:
    if kind == "mcp":
        table, column = AgentMcp, AgentMcp.mcp_id
    elif kind == "skill":
        table, column = AgentSkill, AgentSkill.skill_id
    else:
        raise ValueError(f"不支持的集成类型: {kind}")
    rows = await session.scalars(select(column).where(table.agent_id == agent_id))
    return list(rows)
