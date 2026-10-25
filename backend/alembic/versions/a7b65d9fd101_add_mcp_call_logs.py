"""Record tenant-scoped MCP tool call outcomes and latency."""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import Text
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "a7b65d9fd101"
down_revision: str | None = "f91d8f2e661a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mcp_call_log",
        sa.Column("id", sa.Uuid(), nullable=False, comment="主键，UUID"),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, comment="所属租户（RLS 依赖）"),
        sa.Column("application_id", sa.Uuid(), nullable=False, comment="调用所属应用"),
        sa.Column("agent_id", sa.Uuid(), nullable=False, comment="发起调用的 Agent"),
        sa.Column("mcp_id", sa.Uuid(), nullable=False, comment="目标 MCP 服务"),
        sa.Column("tool_id", sa.Uuid(), nullable=False, comment="目标 MCP 工具"),
        sa.Column("request_id", sa.String(length=128), nullable=True, comment="关联平台请求 ID"),
        sa.Column("status", sa.String(length=16), nullable=False, comment="调用结果：success/error"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, comment="调用耗时（毫秒）"),
        sa.Column("error_code", sa.String(length=64), nullable=True, comment="脱敏错误类型"),
        sa.Column("input_summary", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=True, comment="脱敏后的参数摘要，不保存原始内容"),
        sa.Column("output_summary", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=True, comment="脱敏后的结果摘要，不保存原始内容"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, comment="调用时间（UTC）"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"]),
        sa.ForeignKeyConstraint(["application_id"], ["application.id"]),
        sa.ForeignKeyConstraint(["agent_id"], ["agent.id"]),
        sa.ForeignKeyConstraint(["mcp_id"], ["mcp_server.id"]),
        sa.ForeignKeyConstraint(["tool_id"], ["mcp_tool.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("tenant_id", "application_id", "agent_id", "mcp_id", "tool_id"):
        op.create_index(f"ix_mcp_call_log_{column}", "mcp_call_log", [column])
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE mcp_call_log ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE mcp_call_log FORCE ROW LEVEL SECURITY")
        op.execute(
            "CREATE POLICY tenant_isolation ON mcp_call_log "
            "USING (tenant_id = current_setting('app.tenant_id', true)::uuid) "
            "WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)"
        )
        comments = {
            "id": "主键，UUID",
            "tenant_id": "所属租户（RLS 依赖）",
            "application_id": "调用所属应用",
            "agent_id": "发起调用的 Agent",
            "mcp_id": "目标 MCP 服务",
            "tool_id": "目标 MCP 工具",
            "request_id": "关联平台请求 ID",
            "status": "调用结果：success/error",
            "latency_ms": "调用耗时（毫秒）",
            "error_code": "脱敏错误类型",
            "input_summary": "脱敏后的参数摘要，不保存原始内容",
            "output_summary": "脱敏后的结果摘要，不保存原始内容",
            "created_at": "调用时间（UTC）",
        }
        for column, comment in comments.items():
            escaped = comment.replace("'", "''")
            op.execute(sa.text(f'COMMENT ON COLUMN "mcp_call_log"."{column}" IS \'{escaped}\''))


def downgrade() -> None:
    for column in ("tool_id", "mcp_id", "agent_id", "application_id", "tenant_id"):
        op.drop_index(f"ix_mcp_call_log_{column}", table_name="mcp_call_log")
    op.drop_table("mcp_call_log")
