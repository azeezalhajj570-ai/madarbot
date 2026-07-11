"""add unique constraint to agents.phone_number

Revision ID: 20260711_agent_phone_unique
Revises: 20260711_sender_dedup_fix
Create Date: 2026-07-11

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260711_agent_phone_unique"
down_revision = "20260711_sender_dedup_fix"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_agents_phone_number",
        "agents",
        ["phone_number"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_agents_phone_number", "agents", type_="unique")
