"""add is_bot column to users

Revision ID: 20260512_0020
Revises: f481f13f8074
Create Date: 2026-05-12 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260512_0020"
down_revision = "f481f13f8074"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_bot", sa.Boolean(), server_default=sa.text("false"), nullable=False))


def downgrade() -> None:
    op.drop_column("users", "is_bot")
