"""make agent_leads.agent_id nullable for bot-executor lead capture

Revision ID: 20260507_0072
Revises: 3c86c37f7933
Create Date: 2026-05-07
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "20260507_0072"
down_revision: str = "3c86c37f7933"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("uq_agent_lead_user_group", "agent_leads", type_="unique")
    op.alter_column("agent_leads", "agent_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.alter_column("agent_leads", "agent_id", existing_type=sa.Integer(), nullable=False)
    op.create_unique_constraint("uq_agent_lead_user_group", "agent_leads", ["agent_id", "tg_user_id", "source_group_tg_id"])
