"""Persist discovered MCP tool definitions and Agent bindings."""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import Text
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c17f039ae2d1"
down_revision: str | None = "a6ce26b3419c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mcp_tool",
        sa.Column("id", sa.Uuid(), nullable=False, comment="主键，UUID"),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, comment="所属租户（RLS 依赖）"),
        sa.Column("mcp_id", sa.Uuid(), nullable=False, comment="所属 MCP 服务"),
        sa.Column("name", sa.String(length=128), nullable=False, comment="远端工具名称（服务内唯一）"),
        sa.Column("description", sa.Text(), nullable=True, comment="远端工具说明，视为不可信数据"),
        sa.Column("input_schema", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=False, comment="远端工具参数 JSON Schema，调用前需校验"),
        sa.Column("enabled", sa.Boolean(), nullable=False, comment="是否允许 Agent 绑定及调用"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, comment="创建时间（服务端写入，UTC）"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, comment="最后更新时间（任意写操作自动刷新，UTC）"),
        sa.ForeignKeyConstraint(["mcp_id"], ["mcp_server.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mcp_id", "name", name="uq_mcp_tool_server_name"),
    )
    op.create_index("ix_mcp_tool_mcp_id", "mcp_tool", ["mcp_id"])
    op.create_table(
        "agent_mcp_tool",
        sa.Column("agent_id", sa.Uuid(), nullable=False, comment="关联 Agent（联合主键）"),
        sa.Column("tool_id", sa.Uuid(), nullable=False, comment="关联已注册 MCP 工具（联合主键）"),
        sa.ForeignKeyConstraint(["agent_id"], ["agent.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tool_id"], ["mcp_tool.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("agent_id", "tool_id"),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE mcp_tool ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE mcp_tool FORCE ROW LEVEL SECURITY")
        op.execute(
            "CREATE POLICY tenant_isolation ON mcp_tool "
            "USING (tenant_id = current_setting('app.tenant_id', true)::uuid) "
            "WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)"
        )
        comments = {
            "id": "主键，UUID",
            "tenant_id": "所属租户（RLS 依赖）",
            "mcp_id": "所属 MCP 服务",
            "name": "远端工具名称（服务内唯一）",
            "description": "远端工具说明，视为不可信数据",
            "input_schema": "远端工具参数 JSON Schema，调用前需校验",
            "enabled": "是否允许 Agent 绑定及调用",
            "created_at": "创建时间（服务端写入，UTC）",
            "updated_at": "最后更新时间（任意写操作自动刷新，UTC）",
        }
        for column, comment in comments.items():
            escaped = comment.replace("'", "''")
            op.execute(sa.text(f'COMMENT ON COLUMN "mcp_tool"."{column}" IS \'{escaped}\''))
        op.execute('COMMENT ON COLUMN "agent_mcp_tool"."agent_id" IS \'关联 Agent（联合主键）\'')
        op.execute('COMMENT ON COLUMN "agent_mcp_tool"."tool_id" IS \'关联已注册 MCP 工具（联合主键）\'')


def downgrade() -> None:
    op.drop_table("agent_mcp_tool")
    op.drop_index("ix_mcp_tool_mcp_id", table_name="mcp_tool")
    op.drop_table("mcp_tool")
