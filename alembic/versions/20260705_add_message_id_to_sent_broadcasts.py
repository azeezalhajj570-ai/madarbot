"""add message_id and tg_chat_id to sent_broadcast_messages

Revision ID: 20260705_message_id
Revises: 20260705_rate_limit_defaults
Create Date: 2026-07-05

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260705_message_id"
down_revision: Union[str, None] = "20260705_rate_limit_defaults"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sent_broadcast_messages",
        sa.Column("message_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "sent_broadcast_messages",
        sa.Column("tg_chat_id", sa.BigInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sent_broadcast_messages", "tg_chat_id")
    op.drop_column("sent_broadcast_messages", "message_id")
