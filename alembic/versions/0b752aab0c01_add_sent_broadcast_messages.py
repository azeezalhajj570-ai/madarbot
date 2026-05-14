"""add sent_broadcast_messages table

Revision ID: 0b752aab0c01
Revises: 20260507_0072
Create Date: 2026-05-13 22:50:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "0b752aab0c01"
down_revision = "20260507_0072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sent_broadcast_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("agent_id", sa.Integer(), sa.ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("agent_jobs.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("tg_user_id", sa.BigInteger(), nullable=True, index=True),
        sa.Column("phone_number", sa.String(32), nullable=True),
        sa.Column("username", sa.String(255), nullable=True),
        sa.Column("tg_group_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column("message_text", sa.Text(), nullable=False),
        sa.Column("message_hash", sa.String(64), nullable=False, index=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="sent", index=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("sent_broadcast_messages")
