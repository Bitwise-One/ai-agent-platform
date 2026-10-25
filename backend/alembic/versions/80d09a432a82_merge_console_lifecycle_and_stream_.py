"""merge console lifecycle and stream replay

Revision ID: 80d09a432a82
Revises: c0197d68c1fd, c9f4e1a2b307
Create Date: 2026-10-25 15:14:07.624059
"""

from collections.abc import Sequence

revision: str = '80d09a432a82'
down_revision: str | None = ('c0197d68c1fd', 'c9f4e1a2b307')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
