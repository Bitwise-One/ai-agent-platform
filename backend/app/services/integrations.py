"""租户级 MCP/Skill 管理及 Agent 绑定。"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import uuid
from typing import TypeVar
from urllib.parse import urlsplit

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, NotFound
from app.models import Agent, AgentMcp, AgentMcpTool, AgentSkill, McpServer, McpToolRecord, Skill
from app.schemas.integration import (
    McpServerCreate,
    McpServerUpdate,
    SkillCreate,
    SkillUpdate,
)

T = TypeVar("T", McpServer, Skill)


async def _validate_mcp_endpoint(url: str) -> None:
    parsed = urlsplit(url)
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password:
        raise AppError(10001, "MCP endpoint URL 非法", 400)
    if parsed.scheme == "http" and parsed.hostname not in local_hosts:
        raise AppError(10001, "非本地 MCP endpoint 必须使用 HTTPS", 400)
    if get_settings().is_prod and (parsed.scheme != "https" or parsed.hostname in local_hosts):
        raise AppError(10003, "生产环境 MCP endpoint 必须使用公网 HTTPS 地址", 400)
    try:
        addresses = await asyncio.get_running_loop().getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except OSError as exc:
        raise AppError(10004, "MCP endpoint 主机无法解析", 400) from exc
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global and not (not get_settings().is_prod and parsed.hostname in local_hosts):
            raise AppError(10003, "MCP endpoint 不允许访问非公网地址", 400)


async def _fetch_mcp_tools(server: McpServer) -> list[dict]:
    """Use the official MCP client; the API process never launches stdio commands."""
    if server.transport == "stdio":
        raise AppError(10003, "stdio MCP 发现必须由受控 Worker 执行", 409)
    url = server.config.get("url")
    if not isinstance(url, str):
        raise AppError(10001, "MCP config 必须包含 endpoint url", 400)
    await _validate_mcp_endpoint(url)

    from mcp.client.session import ClientSession

    async with asyncio.timeout(15):
        if server.transport == "sse":
            from mcp.client.sse import sse_client

            transport_context = sse_client(url, timeout=5, sse_read_timeout=10)
        else:
            from mcp.client.streamable_http import streamable_http_client

            transport_context = streamable_http_client(url)
        async with transport_context as (read_stream, write_stream, *_):
            async with ClientSession(read_stream, write_stream) as client:
                await client.initialize()
                result = await client.list_tools()
    tools = []
    for item in result.tools:
        schema = item.input_schema if isinstance(item.input_schema, dict) else {}
        tools.append({"name": item.name, "description": item.description, "input_schema": schema})
    return tools


async def discover_mcp_tools(
    session: AsyncSession, tenant_id: uuid.UUID, mcp_id: uuid.UUID
) -> list[McpToolRecord]:
    server = await get_mcp(session, tenant_id, mcp_id)
    if server.status != "active":
        raise AppError(10003, "已停用的 MCP 服务不能发现工具", 409)
    try:
        discovered = await _fetch_mcp_tools(server)
    except AppError:
        raise
    except Exception as exc:
        raise AppError(10005, "MCP 工具发现失败，请检查服务状态与协议配置", 502, retriable=True) from exc

    existing = await session.scalars(
        select(McpToolRecord).where(McpToolRecord.tenant_id == tenant_id, McpToolRecord.mcp_id == mcp_id)
    )
    by_name = {row.name: row for row in existing}
    discovered_names: set[str] = set()
    for item in discovered:
        name = item["name"]
        if not isinstance(name, str) or not name or len(name) > 128 or name in discovered_names:
            raise AppError(10001, "MCP 返回了非法或重复的工具名称", 502)
        discovered_names.add(name)
        schema = item["input_schema"]
        if not isinstance(schema, dict):
            raise AppError(10001, f"MCP 工具 {name} 的 input schema 非法", 502)
        row = by_name.get(name)
        if row is None:
            row = McpToolRecord(tenant_id=tenant_id, mcp_id=mcp_id, name=name)
            session.add(row)
        row.description = item.get("description")
        row.input_schema = schema
        row.enabled = True
    for name, row in by_name.items():
        if name not in discovered_names:
            row.enabled = False
    await session.flush()
    rows = await session.scalars(
        select(McpToolRecord).where(McpToolRecord.tenant_id == tenant_id, McpToolRecord.mcp_id == mcp_id).order_by(McpToolRecord.name)
    )
    return list(rows)


async def list_mcp_tools(
    session: AsyncSession, tenant_id: uuid.UUID, mcp_id: uuid.UUID, *, include_disabled: bool = False
) -> list[McpToolRecord]:
    await get_mcp(session, tenant_id, mcp_id)
    filters = [McpToolRecord.tenant_id == tenant_id, McpToolRecord.mcp_id == mcp_id]
    if not include_disabled:
        filters.append(McpToolRecord.enabled.is_(True))
    rows = await session.scalars(select(McpToolRecord).where(*filters).order_by(McpToolRecord.name))
    return list(rows)


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


async def bind_mcp_tools(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, agent_id: uuid.UUID, ids: list[uuid.UUID]
) -> list[uuid.UUID]:
    await _get_agent(session, tenant_id, app_id, agent_id)
    valid = set()
    if ids:
        valid = set((await session.scalars(
            select(McpToolRecord.id)
            .join(McpServer, McpServer.id == McpToolRecord.mcp_id)
            .where(
                McpToolRecord.id.in_(ids),
                McpToolRecord.tenant_id == tenant_id,
                McpToolRecord.enabled.is_(True),
                McpServer.tenant_id == tenant_id,
                McpServer.status == "active",
            )
        )).all())
    missing = [str(item) for item in ids if item not in valid]
    if missing:
        raise NotFound(f"MCP 工具不存在或不可用: {', '.join(missing)}")
    await session.execute(delete(AgentMcpTool).where(AgentMcpTool.agent_id == agent_id))
    for item in ids:
        session.add(AgentMcpTool(agent_id=agent_id, tool_id=item))
    await session.flush()
    return ids


async def get_agent_mcp_tool_ids(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, agent_id: uuid.UUID
) -> list[uuid.UUID]:
    await _get_agent(session, tenant_id, app_id, agent_id)
    rows = await session.scalars(
        select(AgentMcpTool.tool_id)
        .join(McpToolRecord, McpToolRecord.id == AgentMcpTool.tool_id)
        .where(AgentMcpTool.agent_id == agent_id, McpToolRecord.tenant_id == tenant_id)
        .order_by(AgentMcpTool.tool_id)
    )
    return list(rows)


async def get_binding_ids(session: AsyncSession, agent_id: uuid.UUID, kind: str) -> list[uuid.UUID]:
    if kind == "mcp":
        table, column = AgentMcp, AgentMcp.mcp_id
    elif kind == "skill":
        table, column = AgentSkill, AgentSkill.skill_id
    else:
        raise ValueError(f"不支持的集成类型: {kind}")
    rows = await session.scalars(select(column).where(table.agent_id == agent_id))
    return list(rows)
