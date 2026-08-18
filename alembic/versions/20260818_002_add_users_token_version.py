"""add users.token_version for JWT revocation

Revision ID: 20260818_002
Revises: 20260818_001
Create Date: 2026-08-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260818_002"
down_revision: Union[str, None] = "20260818_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("token_version", sa.Integer(), server_default="1", nullable=False))
    op.create_index("ix_users_token_version", "users", ["token_version"])


def downgrade() -> None:
    op.drop_index("ix_users_token_version", table_name="users")
    op.drop_column("users", "token_version")
