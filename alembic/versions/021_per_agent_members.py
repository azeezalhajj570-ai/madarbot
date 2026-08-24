"""per-agent scraped_members rows and re-key member_claims to tg_user_id

Revision ID: 021_per_agent_members
Revises: 020_add_scraped_by_agent_id
Create Date: 2026-08-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "021_per_agent_members"
down_revision: Union[str, None] = "020_add_scraped_by_agent_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # --- A. scraped_members: backfill NULL scraped_by_agent_id, re-key unique index ---

    # Backfill legacy rows to their group's last_agent_id so the new
    # (group, user, agent) unique key has no NULL component.
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            UPDATE scraped_members m
            SET scraped_by_agent_id = g.last_agent_id
            FROM scraped_groups g
            WHERE m.scraped_group_id = g.id
              AND m.scraped_by_agent_id IS NULL
            """
        )

    op.drop_index("ix_scraped_members_group_user", table_name="scraped_members")
    op.create_index(
        "ix_scraped_members_group_user_agent",
        "scraped_members",
        ["tg_group_id", "tg_user_id", "scraped_by_agent_id"],
        unique=True,
    )

    # --- B. member_claims: re-key scraped_member_id -> tg_user_id ---

    op.add_column("member_claims", sa.Column("tg_user_id", sa.BigInteger(), nullable=True))

    if bind.dialect.name == "postgresql":
        op.execute(
            """
            UPDATE member_claims mc
            SET tg_user_id = sm.tg_user_id
            FROM scraped_members sm
            WHERE mc.scraped_member_id = sm.id
            """
        )

    # Drop the old partial unique index before re-creating it on tg_user_id.
    op.drop_index("uq_member_claims_active_per_member", table_name="member_claims")
    op.drop_index("ix_member_claims_tenant_scraped_member", table_name="member_claims")

    op.create_index(
        "uq_member_claims_active_per_member",
        "member_claims",
        ["tenant_id", "tg_user_id"],
        unique=True,
        postgresql_where="status = 'active'",
    )
    op.create_index(
        "ix_member_claims_tenant_member",
        "member_claims",
        ["tenant_id", "tg_user_id"],
        unique=False,
    )

    with op.batch_alter_table("member_claims") as batch_op:
        batch_op.drop_constraint(
            "member_claims_scraped_member_id_fkey", type_="foreignkey"
        )
    op.drop_column("member_claims", "scraped_member_id")

    op.alter_column("member_claims", "tg_user_id", nullable=False)


def downgrade() -> None:
    bind = op.get_bind()

    # Restore scraped_member_id column (nullable first, then backfill).
    op.add_column(
        "member_claims", sa.Column("scraped_member_id", sa.Integer(), nullable=True)
    )

    if bind.dialect.name == "postgresql":
        op.execute(
            """
            UPDATE member_claims mc
            SET scraped_member_id = sm.id
            FROM scraped_members sm
            WHERE mc.tg_user_id = sm.tg_user_id
              AND mc.scraped_group_id = sm.scraped_group_id
            """
        )

    # Re-create the FK. Rows whose scraped_member_id could not be matched would
    # violate the FK; drop them first (they cannot be represented after revert).
    op.execute("DELETE FROM member_claims WHERE scraped_member_id IS NULL")

    with op.batch_alter_table("member_claims") as batch_op:
        batch_op.create_foreign_key(
            "member_claims_scraped_member_id_fkey",
            "scraped_members",
            ["scraped_member_id"],
            ["id"],
            ondelete="CASCADE",
        )

    op.alter_column("member_claims", "scraped_member_id", nullable=False)

    # Restore old indexes.
    op.drop_index("uq_member_claims_active_per_member", table_name="member_claims")
    op.drop_index("ix_member_claims_tenant_member", table_name="member_claims")

    op.create_index(
        "ix_member_claims_tenant_scraped_member",
        "member_claims",
        ["tenant_id", "scraped_member_id"],
        unique=False,
    )
    op.create_index(
        "uq_member_claims_active_per_member",
        "member_claims",
        ["tenant_id", "scraped_member_id"],
        unique=True,
        postgresql_where="status = 'active'",
    )

    op.drop_column("member_claims", "tg_user_id")

    # Restore the original scraped_members unique key.
    op.drop_index(
        "ix_scraped_members_group_user_agent", table_name="scraped_members"
    )
    op.create_index(
        "ix_scraped_members_group_user",
        "scraped_members",
        ["tg_group_id", "tg_user_id"],
        unique=True,
    )
