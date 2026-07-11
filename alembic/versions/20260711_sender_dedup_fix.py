"""add sender_tg_user_id and fix agent_id FK to SET NULL

Revision ID: 20260711_sender_dedup_fix
Revises: 20260705_merge_heads
Create Date: 2026-07-11

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260711_sender_dedup_fix"
down_revision = "20260705_merge_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add sender_tg_user_id column
    op.add_column(
        "sent_broadcast_messages",
        sa.Column("sender_tg_user_id", sa.BigInteger(), nullable=True, index=True),
    )

    # 2. Drop the old CASCADE FK on agent_id
    op.drop_constraint(
        "sent_broadcast_messages_agent_id_fkey",
        "sent_broadcast_messages",
        type_="foreignkey",
    )

    # 3. Recreate FK with ON DELETE SET NULL
    op.create_foreign_key(
        "sent_broadcast_messages_agent_id_fkey",
        "sent_broadcast_messages",
        "agents",
        ["agent_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 4. Backfill sender_tg_user_id from agents table
    op.execute(
        """
        UPDATE sent_broadcast_messages sbm
        SET sender_tg_user_id = a.telegram_user_id
        FROM agents a
        WHERE sbm.agent_id = a.id
          AND sbm.sender_tg_user_id IS NULL
        """
    )

    # 5. Add composite index for efficient dedup lookups
    op.create_index(
        "ix_sent_broadcast_sender_group_hash",
        "sent_broadcast_messages",
        ["sender_tg_user_id", "tg_group_id", "message_hash"],
    )


def downgrade() -> None:
    op.drop_index("ix_sent_broadcast_sender_group_hash")
    op.drop_constraint(
        "sent_broadcast_messages_agent_id_fkey",
        "sent_broadcast_messages",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "sent_broadcast_messages_agent_id_fkey",
        "sent_broadcast_messages",
        "agents",
        ["agent_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_index("ix_sent_broadcast_sender_tg_user_id")
    op.drop_column("sent_broadcast_messages", "sender_tg_user_id")
