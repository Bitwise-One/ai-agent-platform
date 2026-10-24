"""应用、Agent、工作流与版本。"""

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, JSONType, SoftDeleteMixin, TimestampMixin


class Application(Base, TimestampMixin, SoftDeleteMixin):
    """应用 = 业务入口，绑定一个默认工作流。"""

    __tablename__ = "application"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(512))
    # 逻辑外键：application.default_workflow_id -> workflow.id
    # 不建物理 FK 避免与 workflow.application_id 形成循环依赖；
    # PG 迁移脚本中通过 ALTER TABLE 单独添加（见 design/database.md §4）。
    default_workflow_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    default_model_params: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")


class Agent(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "agent"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    model_config_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("model_config.id"), nullable=True
    )
    temperature: Mapped[float] = mapped_column(Float, nullable=False, default=0.7)
    max_context_len: Mapped[int] = mapped_column(Integer, nullable=False, default=8000)
    memory_strategy: Mapped[str] = mapped_column(
        String(32), nullable=False, default="sliding_window"
    )
    # 规则路由关键词（含 re: 前缀表示正则），供 RuleRouter 使用
    keywords: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    # 是否为该应用的默认/兜底 Agent
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")


class Workflow(Base, TimestampMixin):
    """工作流 = LangGraph 图模板。"""

    __tablename__ = "workflow"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    graph_definition: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")


class WorkflowVersion(Base, CreatedAtMixin):
    """工作流版本快照（不可变），支撑灰度与回滚。"""

    __tablename__ = "workflow_version"
    __table_args__ = (
        UniqueConstraint("workflow_id", "version", name="uq_workflow_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workflow_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workflow.id"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    changelog: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
