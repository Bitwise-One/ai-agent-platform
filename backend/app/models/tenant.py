"""租户与成员：平台隔离根。"""

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    CreatedAtMixin,
    JSONType,
    SoftDeleteMixin,
    TimestampMixin,
)


class Tenant(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "tenant"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    quota: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)


class Member(Base, CreatedAtMixin):
    __tablename__ = "member"
    __table_args__ = (UniqueConstraint("tenant_id", "user_id", name="uq_member_tenant_user"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="member")
