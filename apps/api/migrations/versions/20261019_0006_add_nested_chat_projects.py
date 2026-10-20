"""add nested chat projects

Revision ID: 20261019_0006
Revises: 20261019_0005
Create Date: 2026-10-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261019_0006"
down_revision: str | None = "20261019_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("chat_projects", sa.Column("parent_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_chat_projects_parent_id",
        "chat_projects",
        "chat_projects",
        ["parent_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_chat_projects_parent_id", "chat_projects", ["parent_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_projects_parent_id", table_name="chat_projects")
    op.drop_constraint("fk_chat_projects_parent_id", "chat_projects", type_="foreignkey")
    op.drop_column("chat_projects", "parent_id")
