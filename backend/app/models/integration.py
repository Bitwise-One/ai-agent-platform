"""MCP、Skill、模型配置、API Key 与多对多关联表。"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, JSONType, TimestampMixin, utcnow


class McpServer(Base, TimestampMixin):
    __tablename__ = "mcp_server"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="服务名称")
    transport: Mapped[str] = mapped_column(String(16), nullable=False, comment="传输方式：stdio/sse/http")
    config: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict, comment="连接配置（命令/URL/鉴权头，敏感值脱敏后存储）")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", comment="服务状态：active/suspended/deleted")


class McpToolRecord(Base, TimestampMixin):
    __tablename__ = "mcp_tool"
    __table_args__ = (UniqueConstraint("mcp_id", "name", name="uq_mcp_tool_server_name"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    mcp_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mcp_server.id", ondelete="CASCADE"), nullable=False, index=True, comment="所属 MCP 服务")
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="远端工具名称（服务内唯一）")
    description: Mapped[str | None] = mapped_column(Text, comment="远端工具说明，视为不可信数据")
    input_schema: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict, comment="远端工具参数 JSON Schema，调用前需校验")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, comment="是否允许 Agent 绑定及调用")


class McpCallLog(Base):
    __tablename__ = "mcp_call_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, index=True, comment="所属租户（RLS 依赖）")
    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("application.id"), nullable=False, index=True, comment="调用所属应用")
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agent.id"), nullable=False, index=True, comment="发起调用的 Agent")
    mcp_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mcp_server.id"), nullable=False, index=True, comment="目标 MCP 服务")
    tool_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mcp_tool.id"), nullable=False, index=True, comment="目标 MCP 工具")
    request_id: Mapped[str | None] = mapped_column(String(128), comment="关联平台请求 ID")
    status: Mapped[str] = mapped_column(String(16), nullable=False, comment="调用结果：success/error")
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, comment="调用耗时（毫秒）")
    error_code: Mapped[str | None] = mapped_column(String(64), comment="脱敏错误类型")
    input_summary: Mapped[dict | None] = mapped_column(JSONType, comment="脱敏后的参数摘要，不保存原始内容")
    output_summary: Mapped[dict | None] = mapped_column(JSONType, comment="脱敏后的结果摘要，不保存原始内容")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now(), comment="调用时间（UTC）")


class Skill(Base, TimestampMixin):
    __tablename__ = "skill"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="技能名称")
    description: Mapped[str | None] = mapped_column(Text, comment="技能描述")
    instructions: Mapped[str | None] = mapped_column(Text, comment="技能触发后注入 Agent 的受控指令，不执行任意代码")
    wasm_module: Mapped[bytes | None] = mapped_column(LargeBinary, comment="无宿主导入的 WebAssembly Skill 模块，执行受燃料与内存限制")
    params_schema: Mapped[dict | None] = mapped_column(JSONType, comment="入参 JSON Schema（校验与渲染表单用）")
    trigger: Mapped[dict | None] = mapped_column(JSONType, comment="触发条件（关键词/规则）")
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="local", comment="来源：local（自建）/marketplace（内置）")


class ModelConfig(Base, CreatedAtMixin):
    """模型网关的逻辑模型配置。"""

    __tablename__ = "model_config"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="逻辑模型名（业务侧引用）")
    provider: Mapped[str] = mapped_column(String(32), nullable=False, comment="厂商：openai/anthropic/qwen 等")
    model_name: Mapped[str] = mapped_column(String(128), nullable=False, comment="厂商模型名（实际调用用）")
    context_len: Mapped[int | None] = mapped_column(Integer, comment="上下文窗口长度（token）")
    price_in: Mapped[float | None] = mapped_column(Numeric(12, 6), comment="每 1K 输入 token 单价（元）")
    price_out: Mapped[float | None] = mapped_column(Numeric(12, 6), comment="每 1K 输出 token 单价（元）")
    capabilities: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict, comment="能力标签（如 vision、function_call、streaming）")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", comment="状态：active/suspended")


class ApiKey(Base, CreatedAtMixin):
    __tablename__ = "api_key"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    application_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("application.id"), comment="关联应用（可为平台级，故可空）")
    key_hash: Mapped[str] = mapped_column(String(256), nullable=False, unique=True, comment="密钥哈希（明文永不落库）")
    prefix: Mapped[str] = mapped_column(String(16), nullable=False, comment="可读前缀，控制台展示前若干位便于识别")
    scope: Mapped[str] = mapped_column(String(16), nullable=False, default="rw", comment="权限范围：ro/rw/admin")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), comment="过期时间，可空表示永不过期")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", comment="状态：active/revoked/expired")
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), comment="最近使用时间，用于清理闲置密钥")


class AgentKb(Base):
    __tablename__ = "agent_kb"

    agent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent.id"), primary_key=True,
        comment="关联 Agent（联合主键）",
    )
    kb_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_base.id"), primary_key=True,
        comment="关联知识库（联合主键）",
    )


class AgentMcp(Base):
    __tablename__ = "agent_mcp"

    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agent.id"), primary_key=True, comment="关联 Agent（联合主键）")
    mcp_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mcp_server.id"), primary_key=True, comment="关联 MCP 服务（联合主键）")


class AgentMcpTool(Base):
    __tablename__ = "agent_mcp_tool"

    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agent.id", ondelete="CASCADE"), primary_key=True, comment="关联 Agent（联合主键）")
    tool_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mcp_tool.id", ondelete="CASCADE"), primary_key=True, comment="关联已注册 MCP 工具（联合主键）")


class AgentSkill(Base):
    __tablename__ = "agent_skill"

    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agent.id"), primary_key=True, comment="关联 Agent（联合主键）")
    skill_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("skill.id"), primary_key=True, comment="关联技能（联合主键）")


class WorkflowAgent(Base):
    __tablename__ = "workflow_agent"

    workflow_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow.id"), primary_key=True,
        comment="关联工作流（联合主键）",
    )
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agent.id"), primary_key=True, comment="关联 Agent（联合主键）")
