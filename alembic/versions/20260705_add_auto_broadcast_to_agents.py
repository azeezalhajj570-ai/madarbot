"""add auto_broadcast_enabled and auto_broadcast_template to agents

Revision ID: 20260705_auto_broadcast
Revises: 7ccff1383072
Create Date: 2026-07-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260705_auto_broadcast"
down_revision: Union[str, tuple[str, ...]] = "7ccff1383072"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("auto_broadcast_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "agents",
        sa.Column("auto_broadcast_template", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agents", "auto_broadcast_template")
    op.drop_column("agents", "auto_broadcast_enabled")
