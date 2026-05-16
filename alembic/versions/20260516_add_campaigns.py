"""add campaigns table and campaign_id FKs

Revision ID: 20260516_add_campaigns
Revises: 20260515_add_scheduled_at
Create Date: 2026-05-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260516_add_campaigns"
down_revision: Union[str, tuple[str, ...]] = "20260515_add_scheduled_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "campaigns",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("type", sa.String(32), nullable=False, server_default="broadcast"),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("message_template", sa.Text(), nullable=True),
        sa.Column("target_filters", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("total_recipients", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["agent_id"], ["agents.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_campaigns_agent_id", "campaigns", ["agent_id"])
    op.create_index("ix_campaigns_type", "campaigns", ["type"])
    op.create_index("ix_campaigns_status", "campaigns", ["status"])
    op.create_index("ix_campaigns_agent_status", "campaigns", ["agent_id", "status"])

    op.add_column(
        "agent_jobs",
        sa.Column("campaign_id", sa.Integer(), nullable=True),
    )
    op.create_index("ix_agent_jobs_campaign_id", "agent_jobs", ["campaign_id"])
    op.create_foreign_key(
        "fk_agent_jobs_campaign_id",
        "agent_jobs",
        "campaigns",
        ["campaign_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "sent_broadcast_messages",
        sa.Column("campaign_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_sent_broadcast_campaign_id",
        "sent_broadcast_messages",
        ["campaign_id"],
    )
    op.create_index(
        "ix_sent_broadcast_campaign_user",
        "sent_broadcast_messages",
        ["campaign_id", "tg_user_id"],
    )
    op.create_foreign_key(
        "fk_sent_broadcast_campaign_id",
        "sent_broadcast_messages",
        "campaigns",
        ["campaign_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_sent_broadcast_campaign_id",
        "sent_broadcast_messages",
        type_="foreignkey",
    )
    op.drop_index(
        "ix_sent_broadcast_campaign_user",
        table_name="sent_broadcast_messages",
    )
    op.drop_index(
        "ix_sent_broadcast_campaign_id",
        table_name="sent_broadcast_messages",
    )
    op.drop_column("sent_broadcast_messages", "campaign_id")

    op.drop_constraint(
        "fk_agent_jobs_campaign_id",
        "agent_jobs",
        type_="foreignkey",
    )
    op.drop_index("ix_agent_jobs_campaign_id", table_name="agent_jobs")
    op.drop_column("agent_jobs", "campaign_id")

    op.drop_index("ix_campaigns_agent_status", table_name="campaigns")
    op.drop_index("ix_campaigns_status", table_name="campaigns")
    op.drop_index("ix_campaigns_type", table_name="campaigns")
    op.drop_index("ix_campaigns_agent_id", table_name="campaigns")
    op.drop_table("campaigns")
