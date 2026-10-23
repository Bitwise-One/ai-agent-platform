"""MCP、Skill、模型配置、API Key 与多对多关联表。"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, JSONType, TimestampMixin


class McpServer(Base, TimestampMixin):
    __tablename__ = "mcp_server"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    transport: Mapped[str] = mapped_column(String(16), nullable=False)
    config: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")


class Skill(Base, TimestampMixin):
    __tablename__ = "skill"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    params_schema: Mapped[dict | None] = mapped_column(JSONType)
    trigger: Mapped[dict | None] = mapped_column(JSONType)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="local")


class ModelConfig(Base, CreatedAtMixin):
    """模型网关的逻辑模型配置。"""

    __tablename__ = "model_config"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    model_name: Mapped[str] = mapped_column(String(128), nullable=False)
    context_len: Mapped[int | None] = mapped_column(Integer)
    price_in: Mapped[float | None] = mapped_column(Numeric(12, 6))
    price_out: Mapped[float | None] = mapped_column(Numeric(12, 6))
    capabilities: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")


class ApiKey(Base, CreatedAtMixin):
    __tablename__ = "api_key"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    application_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("application.id"))
    key_hash: Mapped[str] = mapped_column(String(256), nullable=False, unique=True)
    prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    scope: Mapped[str] = mapped_column(String(16), nullable=False, default="rw")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AgentKb(Base):
    __tablename__ = "agent_kb"

    agent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent.id"), primary_key=True
    )
    kb_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_base.id"), primary_key=True
    )


class AgentMcp(Base):
    __tablename__ = "agent_mcp"

    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agent.id"), primary_key=True)
    mcp_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mcp_server.id"), primary_key=True)


class AgentSkill(Base):
    __tablename__ = "agent_skill"

    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agent.id"), primary_key=True)
    skill_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("skill.id"), primary_key=True)


class WorkflowAgent(Base):
    __tablename__ = "workflow_agent"

    workflow_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow.id"), primary_key=True
    )
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agent.id"), primary_key=True)
