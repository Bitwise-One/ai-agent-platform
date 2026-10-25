"""租户接口（平台级）。"""

import uuid

from fastapi import APIRouter, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import DbDep, get_request_id
from app.schemas.common import ApiResponse, Page, PageQuery
from app.schemas.tenant import TenantCreate, TenantOut, TenantUpdate
from app.services import tenants as tenant_service

router = APIRouter(prefix="/tenants", tags=["tenants"])


@router.post("", response_model=ApiResponse[TenantOut])
async def create_tenant(
    payload: TenantCreate, request: Request, db: AsyncSession = DbDep
) -> ApiResponse[TenantOut]:
    tenant = await tenant_service.create_tenant(db, payload)
    return ApiResponse(data=TenantOut.model_validate(tenant), request_id=get_request_id(request))


@router.get("", response_model=ApiResponse[Page[TenantOut]])
async def list_tenants(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: AsyncSession = DbDep,
) -> ApiResponse[Page[TenantOut]]:
    rows, total = await tenant_service.list_tenants(db, PageQuery(page=page, page_size=page_size))
    return ApiResponse(
        data=Page[TenantOut](
            items=[TenantOut.model_validate(r) for r in rows],
            total=total,
            page=page,
            page_size=page_size,
        ),
        request_id=get_request_id(request),
    )


@router.get("/{tenant_id}", response_model=ApiResponse[TenantOut])
async def get_tenant(
    tenant_id: uuid.UUID, request: Request, db: AsyncSession = DbDep
) -> ApiResponse[TenantOut]:
    tenant = await tenant_service.get_tenant(db, tenant_id)
    return ApiResponse(data=TenantOut.model_validate(tenant), request_id=get_request_id(request))


@router.patch("/{tenant_id}", response_model=ApiResponse[TenantOut])
async def update_tenant(
    tenant_id: uuid.UUID,
    payload: TenantUpdate,
    request: Request,
    db: AsyncSession = DbDep,
) -> ApiResponse[TenantOut]:
    tenant = await tenant_service.update_tenant(db, tenant_id, payload)
    return ApiResponse(data=TenantOut.model_validate(tenant), request_id=get_request_id(request))


@router.delete("/{tenant_id}", response_model=ApiResponse[dict])
async def delete_tenant(
    tenant_id: uuid.UUID, request: Request, db: AsyncSession = DbDep
) -> ApiResponse[dict]:
    await tenant_service.delete_tenant(db, tenant_id)
    return ApiResponse(data={"deleted": str(tenant_id)}, request_id=get_request_id(request))
