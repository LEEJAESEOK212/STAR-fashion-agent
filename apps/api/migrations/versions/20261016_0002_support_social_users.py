"""support social users

Revision ID: 20261016_0002
Revises: 20261016_0001
Create Date: 2026-10-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261016_0002"
down_revision: str | None = "20261016_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("users", "email", existing_type=sa.String(length=320), nullable=True)
    op.create_unique_constraint(
        "uq_users_auth_provider_user_id",
        "users",
        ["auth_provider", "provider_user_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_users_auth_provider_user_id", "users", type_="unique")
    op.alter_column("users", "email", existing_type=sa.String(length=320), nullable=False)
