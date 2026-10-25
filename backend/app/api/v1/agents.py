"""Agent 接口。全部带租户 + 应用作用域。"""

import uuid

from fastapi import APIRouter, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ContextDep, DbDep, RequestContext, get_request_id
from app.schemas.agent import AgentCreate, AgentKbBind, AgentOut, AgentUpdate
from app.schemas.common import ApiResponse
from app.schemas.integration import IntegrationBind
from app.services import agents as agent_service
from app.services import integrations as integration_service

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


@router.get("/{agent_id}/knowledge-bases", response_model=ApiResponse[dict])
async def get_bound_knowledge_bases(
    app_id: uuid.UUID,
    agent_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    """读取某 Agent 已绑定的知识库。

    为什么需要这个接口：绑定是「覆盖式」PUT，控制台在编辑表单里必须先回显
    当前绑定，否则用户打开编辑框会看到全未勾选，一保存就把已有绑定清空——
    这是最容易造成数据丢失的一类交互缺陷，因此读接口不是可选项。
    """
    # 先校验 Agent 归属本租户（跨租户一律 404），再读绑定关系
    await agent_service.get_agent(db, ctx.tenant_id, app_id, agent_id)
    kb_ids = await agent_service.get_kb_ids(db, agent_id)
    return ApiResponse(
        data={"agent_id": str(agent_id), "kb_ids": [str(k) for k in kb_ids]},
        request_id=get_request_id(request),
    )


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


@router.get("/{agent_id}/mcp-servers", response_model=ApiResponse[dict])
async def get_bound_mcp_servers(
    app_id: uuid.UUID, agent_id: uuid.UUID, request: Request,
    ctx: RequestContext = ContextDep, db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    await agent_service.get_agent(db, ctx.tenant_id, app_id, agent_id)
    ids = await integration_service.get_binding_ids(db, agent_id, "mcp")
    return ApiResponse(data={"agent_id": str(agent_id), "ids": [str(item) for item in ids]}, request_id=get_request_id(request))


@router.put("/{agent_id}/mcp-servers", response_model=ApiResponse[dict])
async def bind_mcp_servers(
    app_id: uuid.UUID, agent_id: uuid.UUID, payload: IntegrationBind, request: Request,
    ctx: RequestContext = ContextDep, db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    ids = await integration_service.bind_mcp(db, ctx.tenant_id, app_id, agent_id, payload.ids)
    return ApiResponse(data={"agent_id": str(agent_id), "ids": [str(item) for item in ids]}, request_id=get_request_id(request))


@router.get("/{agent_id}/skills", response_model=ApiResponse[dict])
async def get_bound_skills(
    app_id: uuid.UUID, agent_id: uuid.UUID, request: Request,
    ctx: RequestContext = ContextDep, db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    await agent_service.get_agent(db, ctx.tenant_id, app_id, agent_id)
    ids = await integration_service.get_binding_ids(db, agent_id, "skill")
    return ApiResponse(data={"agent_id": str(agent_id), "ids": [str(item) for item in ids]}, request_id=get_request_id(request))


@router.put("/{agent_id}/skills", response_model=ApiResponse[dict])
async def bind_skills(
    app_id: uuid.UUID, agent_id: uuid.UUID, payload: IntegrationBind, request: Request,
    ctx: RequestContext = ContextDep, db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    ids = await integration_service.bind_skill(db, ctx.tenant_id, app_id, agent_id, payload.ids)
    return ApiResponse(data={"agent_id": str(agent_id), "ids": [str(item) for item in ids]}, request_id=get_request_id(request))
