"""应用接口：全部带租户作用域。"""

import uuid

from fastapi import APIRouter, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ContextDep, DbDep, RequestContext, get_request_id
from app.schemas.common import ApiResponse, Page, PageQuery
from app.schemas.tenant import ApplicationCreate, ApplicationOut, ApplicationUpdate
from app.services import applications as app_service

router = APIRouter(prefix="/apps", tags=["applications"])


@router.post("", response_model=ApiResponse[ApplicationOut])
async def create_app(
    payload: ApplicationCreate,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[ApplicationOut]:
    app = await app_service.create_application(db, ctx.tenant_id, payload)
    return ApiResponse(data=ApplicationOut.model_validate(app), request_id=get_request_id(request))


@router.get("", response_model=ApiResponse[Page[ApplicationOut]])
async def list_apps(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[Page[ApplicationOut]]:
    rows, total = await app_service.list_applications(
        db, ctx.tenant_id, PageQuery(page=page, page_size=page_size)
    )
    return ApiResponse(
        data=Page[ApplicationOut](
            items=[ApplicationOut.model_validate(r) for r in rows],
            total=total,
            page=page,
            page_size=page_size,
        ),
        request_id=get_request_id(request),
    )


@router.get("/{app_id}", response_model=ApiResponse[ApplicationOut])
async def get_app(
    app_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[ApplicationOut]:
    app = await app_service.get_application(db, ctx.tenant_id, app_id)
    return ApiResponse(data=ApplicationOut.model_validate(app), request_id=get_request_id(request))


@router.patch("/{app_id}", response_model=ApiResponse[ApplicationOut])
async def update_app(
    app_id: uuid.UUID,
    payload: ApplicationUpdate,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[ApplicationOut]:
    app = await app_service.update_application(db, ctx.tenant_id, app_id, payload)
    return ApiResponse(data=ApplicationOut.model_validate(app), request_id=get_request_id(request))


@router.delete("/{app_id}", response_model=ApiResponse[dict])
async def delete_app(
    app_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    await app_service.delete_application(db, ctx.tenant_id, app_id)
    return ApiResponse(data={"deleted": str(app_id)}, request_id=get_request_id(request))
