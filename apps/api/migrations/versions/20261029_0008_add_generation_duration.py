"""add chat generation duration

Revision ID: 20261029_0008
Revises: 20261021_0007
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261029_0008"
down_revision: str | None = "20261021_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("generation_duration_ms", sa.BigInteger(), nullable=True),
    )
    op.execute(
        """
        WITH ordered AS (
            SELECT
                id,
                role,
                created_at,
                lag(role) OVER (
                    PARTITION BY session_id ORDER BY created_at, id
                ) AS previous_role,
                lag(created_at) OVER (
                    PARTITION BY session_id ORDER BY created_at, id
                ) AS previous_created_at
            FROM chat_messages
        )
        UPDATE chat_messages AS message
        SET generation_duration_ms = GREATEST(
            1000,
            LEAST(
                86400000,
                ROUND(EXTRACT(EPOCH FROM (ordered.created_at - ordered.previous_created_at)) * 1000)
            )
        )
        FROM ordered
        WHERE message.id = ordered.id
          AND ordered.role = 'assistant'
          AND ordered.previous_role = 'user'
          AND ordered.previous_created_at IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_column("chat_messages", "generation_duration_ms")
