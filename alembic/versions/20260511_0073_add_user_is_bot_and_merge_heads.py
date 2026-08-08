"""add users.is_bot column and merge parallel heads

Revision ID: 20260511_0073
Revises: 20260507_0072, 3c86c37f7933
Create Date: 2026-05-11

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260511_0073"
down_revision: Union[str, tuple[str, ...]] = ("20260507_0072", "3c86c37f7933")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    user_columns = {c["name"] for c in inspector.get_columns("users")}
    if "is_bot" not in user_columns:
        op.add_column(
            "users",
            sa.Column("is_bot", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
    user_indexes = {i["name"] for i in inspector.get_indexes("users")}
    if "ix_users_is_bot" not in user_indexes:
        op.create_index(op.f("ix_users_is_bot"), "users", ["is_bot"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_is_bot"), table_name="users")
    op.drop_column("users", "is_bot")
