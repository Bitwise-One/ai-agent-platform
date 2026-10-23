"""会话、消息、隐藏返回、任务运行与 checkpoint。"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, JSONType, TimestampMixin, utcnow


class TaskStatus:
    """任务状态机取值（对应 PRD §4.3.1）。"""

    CREATED = "created"
    RUNNING = "running"
    WAITING_HUMAN = "waiting_human"
    COMPLETED = "completed"
    DEGRADED = "degraded"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    CANCELLED = "cancelled"
    ESCALATED = "escalated"

    TERMINAL = frozenset(
        {COMPLETED, DEGRADED, FAILED, TIMED_OUT, CANCELLED, ESCALATED}
    )
    ALL = frozenset(
        {
            CREATED,
            RUNNING,
            WAITING_HUMAN,
            COMPLETED,
            DEGRADED,
            FAILED,
            TIMED_OUT,
            CANCELLED,
            ESCALATED,
        }
    )

    # 允许的状态迁移
    TRANSITIONS: dict[str, frozenset[str]] = {
        CREATED: frozenset({RUNNING, CANCELLED}),
        RUNNING: frozenset({WAITING_HUMAN, *TERMINAL}),
        WAITING_HUMAN: frozenset({RUNNING, CANCELLED, ESCALATED, TIMED_OUT}),
    }

    @classmethod
    def can_transition(cls, src: str, dst: str) -> bool:
        if src in cls.TERMINAL:
            return False
        return dst in cls.TRANSITIONS.get(src, frozenset())


class Conversation(Base, TimestampMixin):
    """会话 = 运行时隔离单元；conversation_id 即 LangGraph thread_id。"""

    __tablename__ = "conversation"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.id"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(128), nullable=False)
    title: Mapped[str | None] = mapped_column(String(256))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    metadata_: Mapped[dict] = mapped_column("metadata", JSONType, nullable=False, default=dict)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Message(Base, CreatedAtMixin):
    __tablename__ = "message"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversation.id"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    tool_calls: Mapped[dict | None] = mapped_column(JSONType)


class HiddenResponse(Base, CreatedAtMixin):
    """隐藏返回：不进聊天框，供前端触发动作。"""

    __tablename__ = "hidden_response"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    message_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("message.id"))
    run_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)


class TaskRun(Base):
    """一次执行，严格遵循状态机。"""

    __tablename__ = "task_run"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversation.id"), nullable=False, index=True
    )
    workflow_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workflow_version.id")
    )
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default=TaskStatus.CREATED, index=True
    )
    input: Mapped[dict | None] = mapped_column(JSONType)
    output: Mapped[dict | None] = mapped_column(JSONType)
    error: Mapped[dict | None] = mapped_column(JSONType)
    token_usage: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    cost: Mapped[float] = mapped_column(Numeric(12, 6), nullable=False, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=func.now(),
        nullable=False,
        index=True,
    )


class Checkpoint(Base):
    """LangGraph checkpoint；thread_id = conversation_id。"""

    __tablename__ = "checkpoint"

    thread_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    checkpoint_ns: Mapped[str] = mapped_column(String(128), primary_key=True, default="")
    checkpoint_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    parent_checkpoint_id: Mapped[uuid.UUID | None] = mapped_column()
    type: Mapped[str | None] = mapped_column(String(16))
    checkpoint: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONType)


class TraceEvent(Base, CreatedAtMixin):
    __tablename__ = "trace_event"

    event_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    node: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    tokens_in: Mapped[int | None] = mapped_column(Integer)
    tokens_out: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str | None] = mapped_column(String(16))
    detail: Mapped[dict | None] = mapped_column(JSONType)


class AuditLog(Base, CreatedAtMixin):
    """审计日志：append-only，独立存储。"""

    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    application_id: Mapped[uuid.UUID | None] = mapped_column()
    conversation_id: Mapped[uuid.UUID | None] = mapped_column()
    actor: Mapped[str | None] = mapped_column(String(128))
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    object_type: Mapped[str | None] = mapped_column(String(64))
    object_id: Mapped[str | None] = mapped_column(String(128))
    result: Mapped[str | None] = mapped_column(String(16))
    detail: Mapped[dict | None] = mapped_column(JSONType)
    source_ip: Mapped[str | None] = mapped_column(String(64))
    request_id: Mapped[str | None] = mapped_column(String(128))
