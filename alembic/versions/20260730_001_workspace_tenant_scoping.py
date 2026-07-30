"""workspace MVP: tenant-scope agents/groups, add plan_features + feature_usage

Adds:
  agents.tenant_id (nullable FK -> tenants.id)
  plan_features (per-plan feature template)
  feature_usage (per-subscription usage counters)

Surfaces (no new column, groups.tenant_id already exists from 20260504_db_redesign.py):
  groups.tenant_id is now mapped in the ORM (see bot/db/models/group.py)

Backfills:
  - Tenant + TenantMembership(role="owner") for every existing User that
    doesn't already own a tenant (auto-created single-member workspace)
  - Agent.tenant_id via linked_by_user_id (tg_user_id) -> users.tg_user_id -> tenant
  - Group.tenant_id via owner_user_id -> tenant
  - Seed plan_features for the existing starter/business/enterprise plans
    (max_agents, max_groups limits) from their prose descriptions in
    20260504_db_redesign.py

Revision ID: 20260730_001
Revises: admission_002
Create Date: 2026-07-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260730_001"
down_revision: Union[str, None] = "admission_002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # =========================================================================
    # 1. Add tenant_id to agents (groups.tenant_id already exists)
    # =========================================================================
    if "tenant_id" not in {c["name"] for c in inspector.get_columns("agents")}:
        op.add_column("agents", sa.Column("tenant_id", sa.Integer(), nullable=True))
        op.create_index("ix_agents_tenant_id", "agents", ["tenant_id"])
        op.create_foreign_key(
            "fk_agents_tenant_id_tenants",
            "agents",
            "tenants",
            ["tenant_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # =========================================================================
    # 2. plan_features
    # =========================================================================
    if "plan_features" not in inspector.get_table_names():
        op.create_table(
            "plan_features",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column(
                "plan_id",
                sa.Integer(),
                sa.ForeignKey("plans.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("feature_key", sa.String(128), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("limit_value", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("plan_id", "feature_key", name="uq_plan_feature_plan_key"),
        )
        op.create_index("ix_plan_features_plan_id", "plan_features", ["plan_id"])
        op.create_index("ix_plan_features_feature_key", "plan_features", ["feature_key"])

    # =========================================================================
    # 3. feature_usage
    # =========================================================================
    if "feature_usage" not in inspector.get_table_names():
        op.create_table(
            "feature_usage",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column(
                "subscription_id",
                sa.Integer(),
                sa.ForeignKey("subscriptions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("feature_key", sa.String(128), nullable=False),
            sa.Column("used_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("period", sa.String(7), nullable=False),
            sa.Column("reset_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "subscription_id", "feature_key", "period", name="uq_feature_usage_sub_key_period"
            ),
        )
        op.create_index("ix_feature_usage_subscription_id", "feature_usage", ["subscription_id"])
        op.create_index("ix_feature_usage_feature_key", "feature_usage", ["feature_key"])
        op.create_index("ix_feature_usage_period", "feature_usage", ["period"])

    # =========================================================================
    # 4. Seed plan_features from the prose limits in 20260504_db_redesign.py
    #    ("1 linked account, 5 groups" / "3 linked accounts, 50 groups" / unlimited)
    # =========================================================================
    op.execute(
        """
        INSERT INTO plan_features (plan_id, feature_key, enabled, limit_value)
        SELECT id, 'max_agents', true, 1 FROM plans WHERE slug = 'starter'
        UNION ALL
        SELECT id, 'max_groups', true, 5 FROM plans WHERE slug = 'starter'
        UNION ALL
        SELECT id, 'max_agents', true, 3 FROM plans WHERE slug = 'business'
        UNION ALL
        SELECT id, 'max_groups', true, 50 FROM plans WHERE slug = 'business'
        UNION ALL
        SELECT id, 'max_agents', true, NULL FROM plans WHERE slug = 'enterprise'
        UNION ALL
        SELECT id, 'max_groups', true, NULL FROM plans WHERE slug = 'enterprise'
        ON CONFLICT DO NOTHING
        """
    )

    # =========================================================================
    # 5. Backfill: auto-create a single-member Tenant + TenantMembership(owner)
    #    for every existing User that doesn't already own one.
    # =========================================================================
    op.execute(
        """
        INSERT INTO tenants (owner_user_id, name, is_active, business_profile, settings)
        SELECT u.id, COALESCE(NULLIF(u.full_name, ''), 'My Workspace'), true, '{}', '{}'
        FROM users u
        WHERE NOT EXISTS (
            SELECT 1 FROM tenants t WHERE t.owner_user_id = u.id
        )
        """
    )
    op.execute(
        """
        INSERT INTO tenant_memberships (tenant_id, user_id, role, is_active)
        SELECT t.id, t.owner_user_id, 'owner', true
        FROM tenants t
        WHERE NOT EXISTS (
            SELECT 1 FROM tenant_memberships tm
            WHERE tm.tenant_id = t.id AND tm.user_id = t.owner_user_id
        )
        """
    )

    # =========================================================================
    # 6. Backfill Agent.tenant_id and Group.tenant_id from the owning user's
    #    (first/owner) tenant. Agent.linked_by_user_id stores tg_user_id, so
    #    the join goes through users.tg_user_id; Group.owner_user_id is
    #    already a users.id FK.
    # =========================================================================
    op.execute(
        """
        UPDATE agents a
        SET tenant_id = t.id
        FROM users u
        JOIN tenants t ON t.owner_user_id = u.id
        WHERE a.linked_by_user_id = u.tg_user_id
          AND a.tenant_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE groups g
        SET tenant_id = t.id
        FROM tenants t
        WHERE g.owner_user_id = t.owner_user_id
          AND g.tenant_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_feature_usage_period", table_name="feature_usage")
    op.drop_index("ix_feature_usage_feature_key", table_name="feature_usage")
    op.drop_index("ix_feature_usage_subscription_id", table_name="feature_usage")
    op.drop_table("feature_usage")

    op.drop_index("ix_plan_features_feature_key", table_name="plan_features")
    op.drop_index("ix_plan_features_plan_id", table_name="plan_features")
    op.drop_table("plan_features")

    op.drop_constraint("fk_agents_tenant_id_tenants", "agents", type_="foreignkey")
    op.drop_index("ix_agents_tenant_id", table_name="agents")
    op.drop_column("agents", "tenant_id")
