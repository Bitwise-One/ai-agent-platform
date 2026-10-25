"""工作流接口：CRUD + 可视化编排数据读写 + 版本发布/回滚。"""

import uuid

from fastapi import APIRouter, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ContextDep, DbDep, RequestContext, get_request_id
from app.schemas.common import ApiResponse
from app.schemas.workflow import (
    GraphDefinition,
    ReleaseRequest,
    RollbackRequest,
    WorkflowCreate,
    WorkflowOut,
    WorkflowUpdate,
    WorkflowVersionCreate,
    WorkflowVersionOut,
)
from app.services import workflows as wf_service

router = APIRouter(prefix="/apps/{app_id}/workflows", tags=["workflows"])


@router.post("", response_model=ApiResponse[WorkflowOut])
async def create_workflow(
    app_id: uuid.UUID,
    payload: WorkflowCreate,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[WorkflowOut]:
    wf = await wf_service.create_workflow(db, ctx.tenant_id, app_id, payload)
    return ApiResponse(data=WorkflowOut.model_validate(wf), request_id=get_request_id(request))


@router.get("", response_model=ApiResponse[dict])
async def list_workflows(
    app_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    rows = await wf_service.list_workflows(db, ctx.tenant_id, app_id)
    return ApiResponse(
        data={
            "items": [WorkflowOut.model_validate(r).model_dump() for r in rows],
            "total": len(rows),
        },
        request_id=get_request_id(request),
    )


@router.get("/{wf_id}", response_model=ApiResponse[WorkflowOut])
async def get_workflow(
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[WorkflowOut]:
    wf = await wf_service.get_workflow(db, ctx.tenant_id, app_id, wf_id)
    return ApiResponse(data=WorkflowOut.model_validate(wf), request_id=get_request_id(request))


@router.patch("/{wf_id}", response_model=ApiResponse[WorkflowOut])
async def update_workflow(
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    payload: WorkflowUpdate,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[WorkflowOut]:
    wf = await wf_service.update_workflow(db, ctx.tenant_id, app_id, wf_id, payload)
    return ApiResponse(data=WorkflowOut.model_validate(wf), request_id=get_request_id(request))


@router.delete("/{wf_id}", response_model=ApiResponse[dict])
async def archive_workflow(
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    await wf_service.archive_workflow(db, ctx.tenant_id, app_id, wf_id)
    return ApiResponse(data={"deleted": str(wf_id), "archived": True}, request_id=get_request_id(request))


# ---------------------------------------------------------------- 编排数据
@router.get("/{wf_id}/graph", response_model=ApiResponse[GraphDefinition])
async def get_graph(
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[GraphDefinition]:
    graph = await wf_service.get_graph(db, ctx.tenant_id, app_id, wf_id)
    return ApiResponse(data=graph, request_id=get_request_id(request))


@router.put("/{wf_id}/graph", response_model=ApiResponse[GraphDefinition])
async def save_graph(
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    payload: GraphDefinition,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[GraphDefinition]:
    wf = await wf_service.save_graph(db, ctx.tenant_id, app_id, wf_id, payload)
    return ApiResponse(
        data=GraphDefinition(**(wf.graph_definition or {})),
        request_id=get_request_id(request),
    )


# ---------------------------------------------------------------- 版本
@router.post("/{wf_id}/versions", response_model=ApiResponse[WorkflowVersionOut])
async def create_version(
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    payload: WorkflowVersionCreate,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[WorkflowVersionOut]:
    version = await wf_service.create_version(
        db, ctx.tenant_id, app_id, wf_id, payload.changelog, payload.snapshot
    )
    return ApiResponse(
        data=WorkflowVersionOut.model_validate(version), request_id=get_request_id(request)
    )


@router.get("/{wf_id}/versions", response_model=ApiResponse[dict])
async def list_versions(
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    rows = await wf_service.list_versions(db, ctx.tenant_id, app_id, wf_id)
    return ApiResponse(
        data={
            "items": [WorkflowVersionOut.model_validate(r).model_dump() for r in rows],
            "total": len(rows),
        },
        request_id=get_request_id(request),
    )


@router.post("/{wf_id}/release", response_model=ApiResponse[WorkflowVersionOut])
async def release(
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    payload: ReleaseRequest,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[WorkflowVersionOut]:
    version = await wf_service.release(
        db, ctx.tenant_id, app_id, wf_id, payload.version_id, payload.bind_to_app
    )
    return ApiResponse(
        data=WorkflowVersionOut.model_validate(version), request_id=get_request_id(request)
    )


@router.post("/{wf_id}/rollback", response_model=ApiResponse[WorkflowVersionOut])
async def rollback(
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    payload: RollbackRequest,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[WorkflowVersionOut]:
    version = await wf_service.rollback(
        db, ctx.tenant_id, app_id, wf_id, payload.version_id
    )
    return ApiResponse(
        data=WorkflowVersionOut.model_validate(version), request_id=get_request_id(request)
    )
