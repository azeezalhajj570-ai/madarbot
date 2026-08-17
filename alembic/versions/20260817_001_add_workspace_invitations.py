"""add workspace invitations table

Creates workspace_invitations table for the invitation lifecycle:
pending → accepted | declined | expired | revoked

Revision ID: 20260817_001
Revises: 20260809_002
Create Date: 2026-08-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260817_001"
down_revision: Union[str, None] = "20260809_002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workspace_invitations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "tenant_id",
            sa.Integer(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "invited_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "inviter_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column(
            "status", sa.String(20), nullable=False, server_default="pending"
        ),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "expires_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.Column(
            "accepted_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "declined_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "revoked_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_index(
        "ix_workspace_invitations_tenant_id",
        "workspace_invitations",
        ["tenant_id"],
    )
    op.create_index(
        "ix_workspace_invitations_invited_user_id",
        "workspace_invitations",
        ["invited_user_id"],
    )
    op.create_index(
        "ix_workspace_invitations_inviter_user_id",
        "workspace_invitations",
        ["inviter_user_id"],
    )
    op.create_index(
        "ix_workspace_invitations_status",
        "workspace_invitations",
        ["status"],
    )
    op.create_index(
        "ix_workspace_invitations_token",
        "workspace_invitations",
        ["token"],
        unique=True,
    )
    op.create_index(
        "ix_workspace_invitations_created_at",
        "workspace_invitations",
        ["created_at"],
    )

    # Partial unique index: prevent duplicate pending invitations per (tenant, user)
    op.execute(
        """
        CREATE UNIQUE INDEX uq_invitation_pending_per_user
        ON workspace_invitations (tenant_id, invited_user_id)
        WHERE status = 'pending'
        """
    )


def downgrade() -> None:
    op.drop_table("workspace_invitations")
