"""add member_claims table for parallel bulk operations

Revision ID: 019_member_claims
Revises: 20260818_002
Create Date: 2026-08-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "019_member_claims"
down_revision: Union[str, None] = "20260818_002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "member_claims",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("scraped_group_id", sa.Integer(), nullable=False),
        sa.Column("scraped_member_id", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.Integer(), nullable=False),
        sa.Column("agent_job_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["scraped_group_id"], ["scraped_groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["scraped_member_id"], ["scraped_members.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_job_id"], ["agent_jobs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_member_claims_tenant_scraped_member",
        "member_claims",
        ["tenant_id", "scraped_member_id"],
    )
    op.create_index(
        "ix_member_claims_tenant_scraped_group",
        "member_claims",
        ["tenant_id", "scraped_group_id"],
    )
    op.create_index("ix_member_claims_agent_id", "member_claims", ["agent_id"])
    op.create_index("ix_member_claims_status", "member_claims", ["status"])
    op.create_index("ix_member_claims_expires_at", "member_claims", ["expires_at"])
    op.create_index(
        "uq_member_claims_active_per_member",
        "member_claims",
        ["tenant_id", "scraped_member_id"],
        unique=True,
        postgresql_where="status = 'active'",
    )


def downgrade() -> None:
    op.drop_index("uq_member_claims_active_per_member", table_name="member_claims")
    op.drop_index("ix_member_claims_expires_at", table_name="member_claims")
    op.drop_index("ix_member_claims_status", table_name="member_claims")
    op.drop_index("ix_member_claims_agent_id", table_name="member_claims")
    op.drop_index("ix_member_claims_tenant_scraped_group", table_name="member_claims")
    op.drop_index("ix_member_claims_tenant_scraped_member", table_name="member_claims")
    op.drop_table("member_claims")
