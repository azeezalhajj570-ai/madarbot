"""add_unique_index_scraped_conversations

Revision ID: 3c86c37f7933
Revises: b200c300d400
Create Date: 2026-05-05 21:26:12.171603
"""
from alembic import op
import sqlalchemy as sa


revision = '3c86c37f7933'
down_revision = 'b200c300d400'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        'ix_scraped_conv_group_root',
        'scraped_conversations',
        ['scraped_group_id', 'root_message_id'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index('ix_scraped_conv_group_root', table_name='scraped_conversations')
