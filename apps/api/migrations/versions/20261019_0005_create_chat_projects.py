"""create chat projects and pinning

Revision ID: 20261019_0005
Revises: 20261016_0004
Create Date: 2026-10-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261019_0005"
down_revision: str | None = "20261016_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_projects",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("is_pinned", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_projects_user_id", "chat_projects", ["user_id"])
    op.create_index(
        "ix_chat_projects_user_pinned", "chat_projects", ["user_id", "is_pinned"]
    )
    op.add_column("chat_sessions", sa.Column("project_id", sa.Uuid(), nullable=True))
    op.add_column(
        "chat_sessions",
        sa.Column("is_pinned", sa.Boolean(), server_default="false", nullable=False),
    )
    op.create_foreign_key(
        "fk_chat_sessions_project_id",
        "chat_sessions",
        "chat_projects",
        ["project_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_chat_sessions_project_id", "chat_sessions", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_sessions_project_id", table_name="chat_sessions")
    op.drop_constraint("fk_chat_sessions_project_id", "chat_sessions", type_="foreignkey")
    op.drop_column("chat_sessions", "is_pinned")
    op.drop_column("chat_sessions", "project_id")
    op.drop_table("chat_projects")
