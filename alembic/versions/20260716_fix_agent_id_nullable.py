"""make sent_broadcast_messages.agent_id nullable

The FK was changed to ON DELETE SET NULL in 20260711_sender_dedup_fix,
but the column was left NOT NULL, causing DELETE on agents to fail.

Revision ID: 20260716_fix_agent_id_nullable
Revises: 20260711_agent_phone_unique
Create Date: 2026-07-16

"""
from alembic import op
import sqlalchemy as sa


revision = "20260716_fix_agent_id_nullable"
down_revision = "20260711_agent_phone_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("sent_broadcast_messages", "agent_id", nullable=True)


def downgrade() -> None:
    op.alter_column("sent_broadcast_messages", "agent_id", nullable=False)
