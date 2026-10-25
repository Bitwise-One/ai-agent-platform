"""Persist chat idempotency keys and replayable stream events."""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import Text
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c9f4e1a2b307"
down_revision: str | None = "b8a2f7d4c501"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("task_run", sa.Column("application_id", sa.Uuid(), nullable=True, comment="所属应用（幂等键作用域）"))
    op.add_column("task_run", sa.Column("idempotency_key", sa.String(length=128), nullable=True, comment="客户端幂等键（租户与应用内唯一）"))
    op.add_column("task_run", sa.Column("request_hash", sa.String(length=64), nullable=True, comment="请求内容 SHA-256，阻止同键异请求"))
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("task_run", recreate="always") as batch:
            batch.create_foreign_key("fk_task_run_application_id", "application", ["application_id"], ["id"])
            batch.create_unique_constraint("uq_task_run_app_idempotency", ["tenant_id", "application_id", "idempotency_key"])
    else:
        op.create_foreign_key("fk_task_run_application_id", "task_run", "application", ["application_id"], ["id"])
        op.create_unique_constraint("uq_task_run_app_idempotency", "task_run", ["tenant_id", "application_id", "idempotency_key"])
    op.create_table(
        "run_stream_event",
        sa.Column("run_id", sa.Uuid(), nullable=False, comment="所属任务运行"),
        sa.Column("sequence", sa.Integer(), nullable=False, comment="run 内单调递增事件序号"),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, comment="所属租户（RLS 依赖）"),
        sa.Column("event_type", sa.String(length=32), nullable=False, comment="SSE 事件类型"),
        sa.Column("data", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=False, comment="事件数据（与 SSE data 一致）"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, comment="事件产生时间（UTC）"),
        sa.ForeignKeyConstraint(["run_id"], ["task_run.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"]),
        sa.PrimaryKeyConstraint("run_id", "sequence"),
    )
    op.create_index("ix_run_stream_event_tenant_id", "run_stream_event", ["tenant_id"])
    if op.get_bind().dialect.name == "postgresql":
        for table in ("run_stream_event",):
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
            op.execute(
                f"CREATE POLICY tenant_isolation ON {table} USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)"
            )
        comments = {
            "task_run": {
                "application_id": "所属应用（幂等键作用域）",
                "idempotency_key": "客户端幂等键（租户与应用内唯一）",
                "request_hash": "请求内容 SHA-256，阻止同键异请求",
            },
            "run_stream_event": {
                "run_id": "所属任务运行",
                "sequence": "run 内单调递增事件序号",
                "tenant_id": "所属租户（RLS 依赖）",
                "event_type": "SSE 事件类型",
                "data": "事件数据（与 SSE data 一致）",
                "created_at": "事件产生时间（UTC）",
            },
        }
        for table, columns in comments.items():
            for column, comment in columns.items():
                escaped = comment.replace("'", "''")
                op.execute(sa.text(f'COMMENT ON COLUMN "{table}"."{column}" IS \'{escaped}\''))


def downgrade() -> None:
    op.drop_index("ix_run_stream_event_tenant_id", table_name="run_stream_event")
    op.drop_table("run_stream_event")
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("task_run", recreate="always") as batch:
            batch.drop_constraint("uq_task_run_app_idempotency", type_="unique")
            batch.drop_constraint("fk_task_run_application_id", type_="foreignkey")
    else:
        op.drop_constraint("uq_task_run_app_idempotency", "task_run", type_="unique")
        op.drop_constraint("fk_task_run_application_id", "task_run", type_="foreignkey")
    op.drop_column("task_run", "request_hash")
    op.drop_column("task_run", "idempotency_key")
    op.drop_column("task_run", "application_id")
