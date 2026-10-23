"""add interrupted chat messages

Revision ID: 20261021_0007
Revises: 20261019_0006
Create Date: 2026-10-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261021_0007"
down_revision: str | None = "20261019_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("is_interrupted", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("chat_messages", "is_interrupted")
