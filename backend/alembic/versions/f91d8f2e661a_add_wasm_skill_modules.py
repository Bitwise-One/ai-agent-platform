"""Store isolated WebAssembly Skill modules."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f91d8f2e661a"
down_revision: str | None = "d39e7c51bc14"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "skill",
        sa.Column(
            "wasm_module",
            sa.LargeBinary(),
            nullable=True,
            comment="无宿主导入的 WebAssembly Skill 模块，执行受燃料与内存限制",
        ),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            'COMMENT ON COLUMN "skill"."wasm_module" IS '
            "'无宿主导入的 WebAssembly Skill 模块，执行受燃料与内存限制'"
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute('COMMENT ON COLUMN "skill"."wasm_module" IS NULL')
    op.drop_column("skill", "wasm_module")
