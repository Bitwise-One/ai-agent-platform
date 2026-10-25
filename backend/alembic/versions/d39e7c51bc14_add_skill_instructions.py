"""Add guarded instruction content to local Skills."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d39e7c51bc14"
down_revision: str | None = "c17f039ae2d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "skill",
        sa.Column(
            "instructions",
            sa.Text(),
            nullable=True,
            comment="技能触发后注入 Agent 的受控指令，不执行任意代码",
        ),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            'COMMENT ON COLUMN "skill"."instructions" IS '
            "'技能触发后注入 Agent 的受控指令，不执行任意代码'"
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute('COMMENT ON COLUMN "skill"."instructions" IS NULL')
    op.drop_column("skill", "instructions")
