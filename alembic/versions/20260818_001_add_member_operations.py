"""add member_operations table

Tracks invitation fallback operations for members that couldn't be
directly added to a group during bulk-add operations.

Revision ID: 20260818_001
Revises: 20260817_001
Create Date: 2026-08-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260818_001"
down_revision: Union[str, None] = "20260817_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "member_operations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tg_group_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column("tg_user_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column(
            "agent_id",
            sa.Integer(),
            sa.ForeignKey("agents.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "job_id",
            sa.Integer(),
            sa.ForeignKey("agent_jobs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "operation_type",
            sa.String(32),
            nullable=False,
            server_default="invite_link",
        ),
        sa.Column(
            "status",
            sa.String(32),
            nullable=False,
            server_default="pending",
            index=True,
        ),
        sa.Column("failure_reason", sa.String(128), nullable=True),
        sa.Column("invitation_link", sa.String(512), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "tg_group_id",
            "tg_user_id",
            "operation_type",
            name="uq_member_operation_group_user_type",
        ),
    )


def downgrade() -> None:
    op.drop_table("member_operations")
