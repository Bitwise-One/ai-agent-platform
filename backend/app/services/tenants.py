"""租户服务。跨租户访问一律拒绝。"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound
from app.models import Tenant
from app.schemas.common import PageQuery
from app.schemas.tenant import TenantCreate, TenantUpdate


async def create_tenant(session: AsyncSession, payload: TenantCreate) -> Tenant:
    exists = await session.scalar(select(Tenant.id).where(Tenant.slug == payload.slug))
    if exists:
        raise Conflict(f"租户 slug 已存在: {payload.slug}")

    tenant = Tenant(name=payload.name, slug=payload.slug, quota=payload.quota)
    session.add(tenant)
    await session.flush()
    return tenant


async def list_tenants(session: AsyncSession, page: PageQuery) -> tuple[list[Tenant], int]:
    total = await session.scalar(select(func.count()).select_from(Tenant)) or 0
    rows = await session.scalars(
        select(Tenant)
        .where(Tenant.deleted_at.is_(None))
        .order_by(Tenant.created_at.desc())
        .offset(page.offset)
        .limit(page.page_size)
    )
    return list(rows), total


async def get_tenant(session: AsyncSession, tenant_id: uuid.UUID) -> Tenant:
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise NotFound("租户不存在")
    return tenant


async def update_tenant(
    session: AsyncSession, tenant_id: uuid.UUID, payload: TenantUpdate
) -> Tenant:
    tenant = await get_tenant(session, tenant_id)
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(tenant, key, value)
    await session.flush()
    return tenant


async def ensure_tenant_matches(session: AsyncSession, tenant_id: uuid.UUID) -> None:
    """校验租户存在且可用，作为请求上下文的第一道闸。"""
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None or tenant.deleted_at is not None:
        raise Forbidden("租户不存在或已停用")
    if tenant.status != "active":
        raise Forbidden(f"租户状态为 {tenant.status}，禁止访问")
