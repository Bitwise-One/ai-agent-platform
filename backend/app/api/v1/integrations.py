"""MCP Server 与 Skill 管理接口。"""

import uuid

from fastapi import APIRouter, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ContextDep, DbDep, RequestContext, get_request_id
from app.schemas.common import ApiResponse
from app.schemas.integration import (
    McpServerCreate,
    McpServerOut,
    McpServerUpdate,
    SkillCreate,
    SkillOut,
    SkillUpdate,
)
from app.services import integrations as service

mcp_router = APIRouter(prefix="/mcp-servers", tags=["mcp"])
skill_router = APIRouter(prefix="/skills", tags=["skills"])


@mcp_router.post("", response_model=ApiResponse[McpServerOut])
async def create_mcp(payload: McpServerCreate, request: Request, ctx: RequestContext = ContextDep, db: AsyncSession = DbDep):
    return ApiResponse(data=McpServerOut.model_validate(await service.create_mcp(db, ctx.tenant_id, payload)), request_id=get_request_id(request))


@mcp_router.get("", response_model=ApiResponse[dict])
async def list_mcp(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    status: str | None = Query(default=None, pattern="^(active|suspended|deleted)$"),
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
):
    rows, total = await service.list_mcps(
        db, ctx.tenant_id, offset=(page - 1) * page_size, limit=page_size, status=status
    )
    return ApiResponse(data={"items": [McpServerOut.model_validate(row).model_dump() for row in rows], "total": total, "page": page, "page_size": page_size}, request_id=get_request_id(request))


@mcp_router.get("/{mcp_id}", response_model=ApiResponse[McpServerOut])
async def get_mcp(mcp_id: uuid.UUID, request: Request, ctx: RequestContext = ContextDep, db: AsyncSession = DbDep):
    return ApiResponse(data=McpServerOut.model_validate(await service.get_mcp(db, ctx.tenant_id, mcp_id)), request_id=get_request_id(request))


@mcp_router.patch("/{mcp_id}", response_model=ApiResponse[McpServerOut])
async def update_mcp(mcp_id: uuid.UUID, payload: McpServerUpdate, request: Request, ctx: RequestContext = ContextDep, db: AsyncSession = DbDep):
    return ApiResponse(data=McpServerOut.model_validate(await service.update_mcp(db, ctx.tenant_id, mcp_id, payload)), request_id=get_request_id(request))


@mcp_router.delete("/{mcp_id}", response_model=ApiResponse[dict])
async def delete_mcp(mcp_id: uuid.UUID, request: Request, ctx: RequestContext = ContextDep, db: AsyncSession = DbDep):
    await service.delete_mcp(db, ctx.tenant_id, mcp_id)
    return ApiResponse(data={"deleted": str(mcp_id)}, request_id=get_request_id(request))


@skill_router.post("", response_model=ApiResponse[SkillOut])
async def create_skill(payload: SkillCreate, request: Request, ctx: RequestContext = ContextDep, db: AsyncSession = DbDep):
    return ApiResponse(data=SkillOut.model_validate(await service.create_skill(db, ctx.tenant_id, payload)), request_id=get_request_id(request))


@skill_router.get("", response_model=ApiResponse[dict])
async def list_skills(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
):
    rows, total = await service.list_skills(
        db, ctx.tenant_id, offset=(page - 1) * page_size, limit=page_size
    )
    return ApiResponse(data={"items": [SkillOut.model_validate(row).model_dump() for row in rows], "total": total, "page": page, "page_size": page_size}, request_id=get_request_id(request))


@skill_router.get("/{skill_id}", response_model=ApiResponse[SkillOut])
async def get_skill(skill_id: uuid.UUID, request: Request, ctx: RequestContext = ContextDep, db: AsyncSession = DbDep):
    return ApiResponse(data=SkillOut.model_validate(await service.get_skill(db, ctx.tenant_id, skill_id)), request_id=get_request_id(request))


@skill_router.patch("/{skill_id}", response_model=ApiResponse[SkillOut])
async def update_skill(skill_id: uuid.UUID, payload: SkillUpdate, request: Request, ctx: RequestContext = ContextDep, db: AsyncSession = DbDep):
    return ApiResponse(data=SkillOut.model_validate(await service.update_skill(db, ctx.tenant_id, skill_id, payload)), request_id=get_request_id(request))


@skill_router.delete("/{skill_id}", response_model=ApiResponse[dict])
async def delete_skill(skill_id: uuid.UUID, request: Request, ctx: RequestContext = ContextDep, db: AsyncSession = DbDep):
    await service.delete_skill(db, ctx.tenant_id, skill_id)
    return ApiResponse(data={"deleted": str(skill_id)}, request_id=get_request_id(request))
