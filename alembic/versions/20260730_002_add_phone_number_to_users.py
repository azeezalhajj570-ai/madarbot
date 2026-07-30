"""add phone_number to users (for phone+password dashboard login)

Revision ID: 20260730_002
Revises: 20260730_001
Create Date: 2026-07-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260730_002"
down_revision: Union[str, None] = "20260730_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "phone_number" not in {c["name"] for c in inspector.get_columns("users")}:
        op.add_column("users", sa.Column("phone_number", sa.String(32), nullable=True))
        op.create_index("ix_users_phone_number", "users", ["phone_number"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_phone_number", table_name="users")
    op.drop_column("users", "phone_number")
