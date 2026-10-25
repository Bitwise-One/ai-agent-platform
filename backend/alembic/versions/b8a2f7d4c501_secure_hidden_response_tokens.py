"""Add single-use consumption state for hidden response capabilities."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b8a2f7d4c501"
down_revision: str | None = "a7b65d9fd101"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "hidden_response",
        sa.Column(
            "consumed_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="一次性 action token 消费时间",
        ),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            'COMMENT ON COLUMN "hidden_response"."consumed_at" IS '
            "'一次性 action token 消费时间'"
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute('COMMENT ON COLUMN "hidden_response"."consumed_at" IS NULL')
    op.drop_column("hidden_response", "consumed_at")
