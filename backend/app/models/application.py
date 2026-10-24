"""应用、Agent、工作流与版本。"""

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, JSONType, SoftDeleteMixin, TimestampMixin


class Application(Base, TimestampMixin, SoftDeleteMixin):
    """应用 = 业务入口，绑定一个默认工作流。"""

    __tablename__ = "application"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, index=True, comment="所属租户（RLS 依赖此列）")
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="应用名称")
    description: Mapped[str | None] = mapped_column(Text, comment="应用描述")
    icon: Mapped[str | None] = mapped_column(String(512), comment="图标 URL")
    # 逻辑外键：application.default_workflow_id -> workflow.id
    # 不建物理 FK 避免与 workflow.application_id 形成循环依赖；
    # PG 迁移脚本中通过 ALTER TABLE 单独添加（见 design/database.md §4）。
    default_workflow_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True, comment="默认工作流（逻辑外键，无物理 FK 避免循环依赖）")
    default_model_params: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict, comment="默认模型参数（temperature、max_tokens 等）")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", comment="应用状态：active/suspended/deleted")


class Agent(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "agent"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.id"), nullable=False, index=True,
        comment="所属应用",
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="Agent 名称")
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="", comment="系统提示词（行为约束/角色设定）")
    model_config_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("model_config.id"), nullable=True,
        comment="引用的模型配置（可继承应用级默认值）",
    )
    temperature: Mapped[float] = mapped_column(Float, nullable=False, default=0.7, comment="采样温度（默认 0.7），越高越发散")
    max_context_len: Mapped[int] = mapped_column(Integer, nullable=False, default=8000, comment="最大上下文长度（token，默认 8000）")
    memory_strategy: Mapped[str] = mapped_column(
        String(32), nullable=False, default="sliding_window",
        comment="记忆策略：sliding_window/summary/hybrid",
    )
    # 规则路由关键词（含 re: 前缀表示正则），供 RuleRouter 使用
    keywords: Mapped[list] = mapped_column(JSONType, nullable=False, default=list, comment="路由关键词（含 re: 前缀表示正则）")
    # 是否为该应用的默认/兜底 Agent
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否兜底 Agent（路由无命中时回落）")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", comment="状态：active/suspended/deleted")


class Workflow(Base, TimestampMixin):
    """工作流 = LangGraph 图模板。"""

    __tablename__ = "workflow"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.id"), nullable=False, index=True,
        comment="所属应用",
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="工作流名称")
    description: Mapped[str | None] = mapped_column(Text, comment="工作流描述")
    graph_definition: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict, comment="LangGraph 图结构（nodes/edges/路由策略）")
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, comment="当前生效的版本快照 ID")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", comment="状态：draft/published/archived")


class WorkflowVersion(Base, CreatedAtMixin):
    """工作流版本快照（不可变），支撑灰度与回滚。"""

    __tablename__ = "workflow_version"
    __table_args__ = (
        UniqueConstraint("workflow_id", "version", name="uq_workflow_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    workflow_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workflow.id"), nullable=False, comment="所属工作流")
    version: Mapped[int] = mapped_column(Integer, nullable=False, comment="版本号（同工作流内单调递增）")
    snapshot: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict, comment="该版本完整图定义快照")
    changelog: Mapped[str | None] = mapped_column(Text, comment="变更说明")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", comment="状态：draft/released/rolled_back")
