"""应用服务。所有查询强制带 tenant_id 作用域。"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.models import Application
from app.models.base import utcnow
from app.schemas.common import PageQuery
from app.schemas.tenant import ApplicationCreate, ApplicationUpdate


async def create_application(
    session: AsyncSession, tenant_id: uuid.UUID, payload: ApplicationCreate
) -> Application:
    app = Application(
        tenant_id=tenant_id,
        name=payload.name,
        description=payload.description,
        icon=payload.icon,
        default_model_params=payload.default_model_params,
    )
    session.add(app)
    await session.flush()
    return app


async def list_applications(
    session: AsyncSession, tenant_id: uuid.UUID, page: PageQuery
) -> tuple[list[Application], int]:
    base = select(Application).where(
        Application.tenant_id == tenant_id, Application.deleted_at.is_(None)
    )
    total = (
        await session.scalar(
            select(func.count()).select_from(base.subquery())
        )
        or 0
    )
    rows = await session.scalars(
        base.order_by(Application.created_at.desc()).offset(page.offset).limit(page.page_size)
    )
    return list(rows), total


async def get_application(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID
) -> Application:
    """按租户作用域取应用；跨租户等同不存在，避免泄漏存在性。"""
    app = await session.scalar(
        select(Application).where(
            Application.id == app_id,
            Application.tenant_id == tenant_id,
            Application.deleted_at.is_(None),
        )
    )
    if app is None:
        raise NotFound("应用不存在")
    return app


async def update_application(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    payload: ApplicationUpdate,
) -> Application:
    app = await get_application(session, tenant_id, app_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(app, key, value)
    await session.flush()
    return app


async def delete_application(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID
) -> None:
    app = await get_application(session, tenant_id, app_id)
    app.deleted_at = utcnow()
    await session.flush()
