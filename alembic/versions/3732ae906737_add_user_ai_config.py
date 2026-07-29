"""add user_ai_config table

Revision ID: 3732ae906737
Revises: fc0848471b22
Create Date: 2026-07-29 23:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3732ae906737'
down_revision: Union[str, None] = '20260727_001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_ai_config',
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('provider', sa.String(32), nullable=False, server_default='heuristic'),
        sa.Column('api_key', sa.Text(), nullable=True),
        sa.Column('model', sa.String(128), nullable=True),
        sa.Column('base_url', sa.Text(), nullable=True),
        sa.Column('embedding_api_key', sa.Text(), nullable=True),
        sa.Column('embedding_model', sa.String(64), nullable=False, server_default='text-embedding-3-small'),
        sa.Column('pilot_enabled', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('user_id'),
    )


def downgrade() -> None:
    op.drop_table('user_ai_config')
