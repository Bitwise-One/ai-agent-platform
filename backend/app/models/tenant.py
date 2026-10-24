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

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="租户名称")
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, comment="全局唯一可读标识（URL/子域名）")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", comment="租户状态：active/suspended/deleted")
    quota: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict, comment="配额策略：应用数、agent 数、存储、调用量上限等")


class Member(Base, CreatedAtMixin):
    __tablename__ = "member"
    __table_args__ = (UniqueConstraint("tenant_id", "user_id", name="uq_member_tenant_user"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, comment="用户标识（对接 SSO/外部用户体系）")
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="member", comment="角色：admin/developer/member")
