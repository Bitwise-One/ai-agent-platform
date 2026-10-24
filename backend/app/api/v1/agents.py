"""Agent 接口。全部带租户 + 应用作用域。"""

import uuid

from fastapi import APIRouter, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ContextDep, DbDep, RequestContext, get_request_id
from app.schemas.agent import AgentCreate, AgentKbBind, AgentOut, AgentUpdate
from app.schemas.common import ApiResponse
from app.services import agents as agent_service

router = APIRouter(prefix="/apps/{app_id}/agents", tags=["agents"])


@router.post("", response_model=ApiResponse[AgentOut])
async def create_agent(
    app_id: uuid.UUID,
    payload: AgentCreate,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[AgentOut]:
    agent = await agent_service.create_agent(db, ctx.tenant_id, app_id, payload)
    return ApiResponse(data=AgentOut.model_validate(agent), request_id=get_request_id(request))


@router.get("", response_model=ApiResponse[dict])
async def list_agents(
    app_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    rows = await agent_service.list_agents(db, ctx.tenant_id, app_id)
    return ApiResponse(
        data={"items": [AgentOut.model_validate(r).model_dump() for r in rows], "total": len(rows)},
        request_id=get_request_id(request),
    )


@router.get("/{agent_id}", response_model=ApiResponse[AgentOut])
async def get_agent(
    app_id: uuid.UUID,
    agent_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[AgentOut]:
    agent = await agent_service.get_agent(db, ctx.tenant_id, app_id, agent_id)
    return ApiResponse(data=AgentOut.model_validate(agent), request_id=get_request_id(request))


@router.patch("/{agent_id}", response_model=ApiResponse[AgentOut])
async def update_agent(
    app_id: uuid.UUID,
    agent_id: uuid.UUID,
    payload: AgentUpdate,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[AgentOut]:
    agent = await agent_service.update_agent(db, ctx.tenant_id, app_id, agent_id, payload)
    return ApiResponse(data=AgentOut.model_validate(agent), request_id=get_request_id(request))


@router.delete("/{agent_id}", response_model=ApiResponse[dict])
async def delete_agent(
    app_id: uuid.UUID,
    agent_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    await agent_service.delete_agent(db, ctx.tenant_id, app_id, agent_id)
    return ApiResponse(data={"deleted": str(agent_id)}, request_id=get_request_id(request))


@router.put("/{agent_id}/knowledge-bases", response_model=ApiResponse[dict])
async def bind_knowledge_bases(
    app_id: uuid.UUID,
    agent_id: uuid.UUID,
    payload: AgentKbBind,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    """覆盖式绑定知识库，供 RAG 检索使用。"""
    kb_ids = await agent_service.bind_knowledge_bases(
        db, ctx.tenant_id, app_id, agent_id, payload.kb_ids
    )
    return ApiResponse(
        data={"agent_id": str(agent_id), "kb_ids": [str(k) for k in kb_ids]},
        request_id=get_request_id(request),
    )
