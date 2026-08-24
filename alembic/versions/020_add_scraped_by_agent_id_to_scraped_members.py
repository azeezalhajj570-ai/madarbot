"""add scraped_by_agent_id to scraped_members

Revision ID: 020_add_scraped_by_agent_id
Revises: 019_member_claims
Create Date: 2026-08-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "020_add_scraped_by_agent_id"
down_revision: Union[str, None] = "019_member_claims"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("scraped_members")}
    if "scraped_by_agent_id" in columns:
        return

    op.add_column(
        "scraped_members",
        sa.Column("scraped_by_agent_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_scraped_members_scraped_by_agent_id",
        "scraped_members",
        ["scraped_by_agent_id"],
        unique=False,
    )
    with op.batch_alter_table("scraped_members") as batch_op:
        batch_op.create_foreign_key(
            "fk_scraped_members_scraped_by_agent_id",
            "agents",
            ["scraped_by_agent_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("scraped_members") as batch_op:
        batch_op.drop_constraint("fk_scraped_members_scraped_by_agent_id", type_="foreignkey")
    op.drop_index("ix_scraped_members_scraped_by_agent_id", table_name="scraped_members")
    op.drop_column("scraped_members", "scraped_by_agent_id")