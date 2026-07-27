"""add system_config table

Revision ID: 20260727_001
Revises: 5502e6b67ea8
Create Date: 2026-07-27 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "20260727_001"
down_revision = "5502e6b67ea8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_config",
        sa.Column("key", sa.String(120), primary_key=True),
        sa.Column("value", sa.Text, nullable=False, server_default=""),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("system_config")
