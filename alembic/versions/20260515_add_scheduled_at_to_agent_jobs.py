"""add scheduled_at to agent_jobs, merge heads

Revision ID: 20260515_merge_add_scheduled_at
Revises: 3c86c37f7933, 7a76aa564096
Create Date: 2026-05-15
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260515_merge_add_scheduled_at"
down_revision: Union[str, tuple[str, ...]] = ("3c86c37f7933", "7a76aa564096")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agent_jobs",
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_agent_jobs_scheduled_at",
        "agent_jobs",
        ["scheduled_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_jobs_scheduled_at", table_name="agent_jobs")
    op.drop_column("agent_jobs", "scheduled_at")
