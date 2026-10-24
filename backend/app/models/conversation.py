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

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID；同时作为 LangGraph thread_id")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("application.id"), nullable=False, index=True,
        comment="所属应用",
    )
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, comment="终端用户标识（可对接外部系统）")
    title: Mapped[str | None] = mapped_column(String(256), comment="会话标题（首条消息摘要等）")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", comment="状态：active/archived/closed")
    metadata_: Mapped[dict] = mapped_column("metadata", JSONType, nullable=False, default=dict, comment="扩展信息（渠道、设备、来源等）")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), comment="归档时间，非空表示已归档")


class Message(Base, CreatedAtMixin):
    __tablename__ = "message"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversation.id"), nullable=False, index=True,
        comment="所属会话",
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False, comment="角色：user/assistant/system/tool")
    content: Mapped[str | None] = mapped_column(Text, comment="消息文本（tool 角色可能仅含 tool_calls）")
    tool_calls: Mapped[dict | None] = mapped_column(JSONType, comment="模型发起的工具调用（参数与结果），回放免重调")


class HiddenResponse(Base, CreatedAtMixin):
    """隐藏返回：不进聊天框，供前端触发动作。"""

    __tablename__ = "hidden_response"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    message_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("message.id"), comment="关联消息（可空）")
    run_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True, comment="所属任务运行 ID")
    action: Mapped[str] = mapped_column(String(64), nullable=False, comment="动作类型（open_form/navigate/trigger_ticket 等）")
    payload: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict, comment="结构化动作参数")


class TaskRun(Base):
    """一次执行，严格遵循状态机。"""

    __tablename__ = "task_run"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversation.id"), nullable=False, index=True,
        comment="所属会话",
    )
    workflow_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workflow_version.id"),
        comment="关联工作流版本快照（执行时锁定版本）",
    )
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default=TaskStatus.CREATED, index=True,
        comment="状态机：created/running/waiting_human/completed/degraded/failed/timed_out/cancelled/escalated",
    )
    input: Mapped[dict | None] = mapped_column(JSONType, comment="本次执行的输入（query、上下文引用等）")
    output: Mapped[dict | None] = mapped_column(JSONType, comment="执行最终输出（含回复、动作）")
    error: Mapped[dict | None] = mapped_column(JSONType, comment="错误信息（异常类型/堆栈摘要）")
    token_usage: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, comment="累计 token 消耗")
    cost: Mapped[float] = mapped_column(Numeric(12, 6), nullable=False, default=0, comment="本次执行成本（元，12,6 精度）")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), comment="开始时间")
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), comment="结束时间")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        server_default=func.now(),
        nullable=False,
        index=True,
        comment="创建时间（服务端写入，UTC）",
    )


class Checkpoint(Base):
    """LangGraph checkpoint；thread_id = conversation_id。"""

    __tablename__ = "checkpoint"

    thread_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, comment="线程 ID，直接取 conversation_id（一条会话一条线程），联合主键之一")
    checkpoint_ns: Mapped[str] = mapped_column(String(128), primary_key=True, default="", comment="检查点命名空间，联合主键之一，默认空串")
    checkpoint_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, comment="检查点 ID，联合主键之一")
    parent_checkpoint_id: Mapped[uuid.UUID | None] = mapped_column(comment="父检查点 ID，用于回溯执行路径，可空")
    type: Mapped[str | None] = mapped_column(String(16), comment="类型：channel（通道状态）/task（任务），可空")
    checkpoint: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict, comment="图执行的完整状态快照")
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONType, comment="LangGraph 写入的元数据（来源、步数等）")


class TraceEvent(Base, CreatedAtMixin):
    __tablename__ = "trace_event"

    event_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    run_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True, comment="所属任务运行 ID（一次执行产生多条事件）")
    node: Mapped[str] = mapped_column(String(128), nullable=False, comment="图节点名称/标识")
    kind: Mapped[str] = mapped_column(String(16), nullable=False, comment="事件种类：llm/tool/node/route")
    latency_ms: Mapped[int | None] = mapped_column(Integer, comment="该节点耗时（毫秒）")
    tokens_in: Mapped[int | None] = mapped_column(Integer, comment="输入 token 数")
    tokens_out: Mapped[int | None] = mapped_column(Integer, comment="输出 token 数")
    status: Mapped[str | None] = mapped_column(String(16), comment="节点状态：success/error/retry")
    detail: Mapped[dict | None] = mapped_column(JSONType, comment="结构化明细（模型名、错误、重试原因等）")


class AuditLog(Base, CreatedAtMixin):
    """审计日志：append-only，独立存储。"""

    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID 全局唯一标识")
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(index=True, comment="所属租户；可空（未确定租户的事件），RLS 额外放行 NULL")
    application_id: Mapped[uuid.UUID | None] = mapped_column(comment="关联应用，可空")
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(comment="关联会话，可空")
    actor: Mapped[str | None] = mapped_column(String(128), comment="操作者标识（用户/服务账号），可空")
    action: Mapped[str] = mapped_column(String(64), nullable=False, comment="动作类型（如 login/create/update/delete）")
    object_type: Mapped[str | None] = mapped_column(String(64), comment="被操作对象类型（如 application/agent/document），可空")
    object_id: Mapped[str | None] = mapped_column(String(128), comment="被操作对象 ID，可空")
    result: Mapped[str | None] = mapped_column(String(16), comment="操作结果：success/denied/failed，可空")
    detail: Mapped[dict | None] = mapped_column(JSONType, comment="结构化上下文（前后值差异、错误摘要等）")
    source_ip: Mapped[str | None] = mapped_column(String(64), comment="来源 IP，可空")
    request_id: Mapped[str | None] = mapped_column(String(128), comment="请求追踪 ID，便于串联链路，可空")
