"""add agent_blacklist table

Revision ID: 7ccff1383072
Revises: f481f13f8074
Create Date: 2026-07-03 21:30:00.000000
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "7ccff1383072"
down_revision: str | tuple[str, ...] = "f481f13f8074"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "agent_blacklist",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.Integer(), nullable=False),
        sa.Column("tg_user_id", sa.BigInteger(), nullable=True),
        sa.Column("username", sa.String(255), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("reason", sa.String(64), nullable=False, server_default="admin_blocked"),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agent_id", "tg_user_id", name="uq_blacklist_agent_user"),
    )
    op.create_index(op.f("ix_agent_blacklist_agent_id"), "agent_blacklist", ["agent_id"])
    op.create_index(op.f("ix_agent_blacklist_tg_user_id"), "agent_blacklist", ["tg_user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_agent_blacklist_tg_user_id"), table_name="agent_blacklist")
    op.drop_index(op.f("ix_agent_blacklist_agent_id"), table_name="agent_blacklist")
    op.drop_table("agent_blacklist")
