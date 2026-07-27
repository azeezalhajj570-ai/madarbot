"""add pgvector extension and embedding column to group_knowledge

Revision ID: 5502e6b67ea8
Revises: 20260723_001
Create Date: 2026-07-26 01:28:08.825223
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "5502e6b67ea8"
down_revision = "20260723_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column(
        "group_knowledge",
        sa.Column("embedding", Vector(512), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("group_knowledge", "embedding")
    op.execute("DROP EXTENSION IF EXISTS vector")
