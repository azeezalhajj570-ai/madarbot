"""add_campaign_recurrence_and_logs

Revision ID: 20260723_001
Revises: fc0848471b22
Create Date: 2026-07-23 21:30:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "20260723_001"
down_revision = "fc0848471b22"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add recurrence columns to campaigns
    op.add_column("campaigns", sa.Column("recurrence_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("campaigns", sa.Column("repeat_type", sa.String(16), nullable=True))
    op.add_column("campaigns", sa.Column("interval_value", sa.Integer(), nullable=False, server_default=sa.text("1")))
    op.add_column("campaigns", sa.Column("repeat_time", sa.Time(), nullable=True))
    op.add_column("campaigns", sa.Column("cron_expression", sa.String(100), nullable=True))
    op.add_column("campaigns", sa.Column("end_type", sa.String(16), nullable=True))
    op.add_column("campaigns", sa.Column("end_value", sa.String(32), nullable=True))
    op.add_column("campaigns", sa.Column("timezone", sa.String(64), nullable=False, server_default=sa.text("'UTC'")))
    op.add_column("campaigns", sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("campaigns", sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("campaigns", sa.Column("run_count", sa.Integer(), nullable=False, server_default=sa.text("0")))
    op.add_column("campaigns", sa.Column("max_runs", sa.Integer(), nullable=True))

    op.create_index("ix_campaigns_recurrence_next_run", "campaigns", ["recurrence_enabled", "next_run_at"])

    # Create campaign_recurrence_logs table
    op.create_table(
        "campaign_recurrence_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("campaign_recurrence_logs")
    op.drop_index("ix_campaigns_recurrence_next_run", table_name="campaigns")
    op.drop_column("campaigns", "max_runs")
    op.drop_column("campaigns", "run_count")
    op.drop_column("campaigns", "last_run_at")
    op.drop_column("campaigns", "next_run_at")
    op.drop_column("campaigns", "timezone")
    op.drop_column("campaigns", "end_value")
    op.drop_column("campaigns", "end_type")
    op.drop_column("campaigns", "cron_expression")
    op.drop_column("campaigns", "repeat_time")
    op.drop_column("campaigns", "interval_value")
    op.drop_column("campaigns", "repeat_type")
    op.drop_column("campaigns", "recurrence_enabled")
