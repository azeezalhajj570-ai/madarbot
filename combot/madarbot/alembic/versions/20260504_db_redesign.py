"""Create new SaaS schema tables alongside existing legacy tables.

Drops ONLY orphan tables (accounts, account_groups, tasks, task_groups)
that never had ORM models and were migration-only cruft.

Legacy tables (agents, subscription_requests, promotion_codes, etc.)
are KEPT for service compatibility during incremental migration.

Creates:
  products, plans, plan_prices
  subscriptions, subscription_items, entitlements
  payments, checkout_sessions
  linked_accounts, linked_account_groups
  tasks_v2, task_groups_v2, task_runs
  bulk_message_batches, bulk_message_recipients, messaging_suppression_list
  tenant_memberships, user_identities
  audit_logs

Enhances: tenants (slug, is_active, settings), groups (tenant_id)

Revision ID: b200c300d400
Revises: e1f2a3b4c5d6
Create Date: 2026-05-04
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b200c300d400"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing = set(inspector.get_table_names())

    # =========================================================================
    # 0. Drop ONLY orphan tables (never had ORM models, migration-only cruft)
    #    Keep all service-backed tables for compatibility.
    # =========================================================================
    for tbl in ["account_groups", "accounts", "task_groups", "tasks"]:
        if tbl in existing:
            op.execute(f"DROP TABLE IF EXISTS {tbl} CASCADE")

    # =========================================================================
    # 1. Enhance tenants table
    # =========================================================================
    if "slug" not in {c["name"] for c in inspector.get_columns("tenants")}:
        op.add_column("tenants", sa.Column("slug", sa.String(128), nullable=True))
        op.create_index("ix_tenants_slug", "tenants", ["slug"], unique=True)
    if "is_active" not in {c["name"] for c in inspector.get_columns("tenants")}:
        op.add_column("tenants", sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"))
    if "settings" not in {c["name"] for c in inspector.get_columns("tenants")}:
        op.add_column("tenants", sa.Column("settings", sa.JSON(), nullable=False, server_default="{}"))

    # =========================================================================
    # 2. Add tenant_id to groups
    # =========================================================================
    if "tenant_id" not in {c["name"] for c in inspector.get_columns("groups")}:
        op.add_column("groups", sa.Column("tenant_id", sa.Integer(), nullable=True))
        op.create_index("ix_groups_tenant_id", "groups", ["tenant_id"])

    # =========================================================================
    # 3. Product catalog
    # =========================================================================
    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_products_slug", "products", ["slug"], unique=True)

    op.create_table(
        "plans",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
        sa.Column("sort_order", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "slug", name="uq_plan_product_slug"),
    )
    op.create_index("ix_plans_product_id", "plans", ["product_id"])
    op.create_index("ix_plans_slug", "plans", ["slug"])

    op.create_table(
        "plan_prices",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("plan_id", sa.Integer(), sa.ForeignKey("plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(8), server_default="USD"),
        sa.Column("interval", sa.String(16), server_default="month"),
        sa.Column("stripe_price_id", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plan_id", "currency", "interval", name="uq_plan_price_currency_interval"),
    )
    op.create_index("ix_plan_prices_plan_id", "plan_prices", ["plan_id"])
    op.create_index("ix_plan_prices_stripe_price_id", "plan_prices", ["stripe_price_id"])

    # =========================================================================
    # 4. Subscriptions + entitlements
    # =========================================================================
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("plan_id", sa.Integer(), sa.ForeignKey("plans.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trial_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(255), nullable=True),
        sa.Column("metadata", sa.JSON(), server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_subscriptions_tenant_id", "subscriptions", ["tenant_id"])
    op.create_index("ix_subscriptions_plan_id", "subscriptions", ["plan_id"])
    op.create_index("ix_subscriptions_status", "subscriptions", ["status"])
    op.create_index("ix_subscriptions_stripe_subscription_id", "subscriptions", ["stripe_subscription_id"])
    op.execute("""
        CREATE UNIQUE INDEX uq_subscriptions_one_active_per_tenant
        ON subscriptions (tenant_id) WHERE status = 'active'
    """)

    op.create_table(
        "subscription_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("subscription_id", sa.Integer(), sa.ForeignKey("subscriptions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("plan_price_id", sa.Integer(), sa.ForeignKey("plan_prices.id", ondelete="SET NULL"), nullable=True),
        sa.Column("description", sa.String(255), nullable=False),
        sa.Column("quantity", sa.Integer(), server_default="1"),
        sa.Column("unit_amount", sa.Integer(), nullable=False),
        sa.Column("stripe_subscription_item_id", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_subscription_items_subscription_id", "subscription_items", ["subscription_id"])

    op.create_table(
        "entitlements",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("subscription_id", sa.Integer(), sa.ForeignKey("subscriptions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(128), nullable=False),
        sa.Column("value", sa.String(512), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("subscription_id", "key", name="uq_entitlement_subscription_key"),
    )
    op.create_index("ix_entitlements_subscription_id", "entitlements", ["subscription_id"])
    op.create_index("ix_entitlements_key", "entitlements", ["key"])

    # =========================================================================
    # 5. Payments + checkout
    # =========================================================================
    op.create_table(
        "payments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("subscription_id", sa.Integer(), sa.ForeignKey("subscriptions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(8), server_default="USD"),
        sa.Column("status", sa.String(32), server_default="pending"),
        sa.Column("provider_reference", sa.String(255), nullable=True),
        sa.Column("description", sa.String(512), nullable=True),
        sa.Column("metadata", sa.JSON(), server_default="{}"),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_reference", name="uq_payment_v2_provider_ref"),
    )
    op.create_index("ix_payments_subscription_id", "payments", ["subscription_id"])
    op.create_index("ix_payments_tenant_id", "payments", ["tenant_id"])
    op.create_index("ix_payments_status", "payments", ["status"])
    op.create_index("ix_payments_provider_reference", "payments", ["provider_reference"])

    op.create_table(
        "checkout_sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("plan_id", sa.Integer(), sa.ForeignKey("plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tg_user_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(32), server_default="pending"),
        sa.Column("provider", sa.String(32), server_default="stripe"),
        sa.Column("provider_session_id", sa.String(255), nullable=True),
        sa.Column("metadata", sa.JSON(), server_default="{}"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_checkout_sessions_tenant_id", "checkout_sessions", ["tenant_id"])
    op.create_index("ix_checkout_sessions_plan_id", "checkout_sessions", ["plan_id"])
    op.create_index("ix_checkout_sessions_tg_user_id", "checkout_sessions", ["tg_user_id"])
    op.create_index("ix_checkout_sessions_status", "checkout_sessions", ["status"])

    # =========================================================================
    # 6. Linked accounts
    # =========================================================================
    op.create_table(
        "linked_accounts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(32), server_default="telegram"),
        sa.Column("display_name", sa.String(255), server_default=""),
        sa.Column("external_account_id", sa.String(255), nullable=False),
        sa.Column("tg_user_id", sa.BigInteger(), nullable=True),
        sa.Column("phone_number", sa.String(32), nullable=True),
        sa.Column("session_string", sa.Text(), nullable=True),
        sa.Column("phone_code_hash", sa.String(255), nullable=True),
        sa.Column("status", sa.String(32), server_default="active"),
        sa.Column("auth_state", sa.String(32), server_default="active"),
        sa.Column("max_actions_per_hour", sa.Integer(), nullable=True),
        sa.Column("max_messages_per_day", sa.Integer(), nullable=True),
        sa.Column("min_delay_seconds", sa.Float(), nullable=True),
        sa.Column("cooldown_minutes", sa.Integer(), nullable=True),
        sa.Column("safety_mode_enabled", sa.Boolean(), server_default="true"),
        sa.Column("safety_mode_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata", sa.JSON(), server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "provider", "external_account_id", name="uq_linked_account_tenant_provider_ext"),
    )
    op.create_index("ix_linked_accounts_tenant_id", "linked_accounts", ["tenant_id"])
    op.create_index("ix_linked_accounts_provider", "linked_accounts", ["provider"])
    op.create_index("ix_linked_accounts_external_account_id", "linked_accounts", ["external_account_id"])
    op.create_index("ix_linked_accounts_tg_user_id", "linked_accounts", ["tg_user_id"])
    op.create_index("ix_linked_accounts_phone_number", "linked_accounts", ["phone_number"])
    op.create_index("ix_linked_accounts_status", "linked_accounts", ["status"])
    op.create_index("ix_linked_accounts_auth_state", "linked_accounts", ["auth_state"])

    op.create_table(
        "linked_account_groups",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("linked_account_id", sa.Integer(), sa.ForeignKey("linked_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(32), server_default="member"),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("linked_account_id", "group_id", name="uq_linked_account_group"),
    )
    op.create_index("ix_linked_account_groups_linked_account_id", "linked_account_groups", ["linked_account_id"])
    op.create_index("ix_linked_account_groups_group_id", "linked_account_groups", ["group_id"])
    op.create_index("ix_linked_account_groups_role", "linked_account_groups", ["role"])

    # =========================================================================
    # 7. Tasks (generic, product-agnostic)
    # =========================================================================
    op.create_table(
        "tasks_v2",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_code", sa.String(32), nullable=False, server_default="madarbot"),
        sa.Column("trigger_source", sa.String(32), nullable=False, server_default="manual"),
        sa.Column("executor_type", sa.String(32), nullable=False, server_default="linked_account"),
        sa.Column("executor_id", sa.Integer(), nullable=True),
        sa.Column("linked_account_id", sa.Integer(), sa.ForeignKey("linked_accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("target_type", sa.String(32), nullable=False, server_default="group"),
        sa.Column("target_id", sa.Integer(), nullable=True),
        sa.Column("channel_account_id", sa.Integer(), sa.ForeignKey("channel_accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assignment_id", sa.String(64), nullable=False),
        sa.Column("task_key", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(255), server_default=""),
        sa.Column("enabled", sa.Boolean(), server_default="true"),
        sa.Column("status", sa.String(32), server_default="idle"),
        sa.Column("schedule_type", sa.String(32), server_default="manual"),
        sa.Column("schedule_cron", sa.String(128), nullable=True),
        sa.Column("interval_seconds", sa.Integer(), nullable=True),
        sa.Column("conditions", sa.JSON(), nullable=True),
        sa.Column("config", sa.JSON(), nullable=True),
        sa.Column("max_runs_per_day", sa.Integer(), nullable=True),
        sa.Column("max_runs_total", sa.Integer(), nullable=True),
        sa.Column("run_count", sa.Integer(), server_default="0"),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "assignment_id", name="uq_task_tenant_assignment"),
    )
    op.create_index("ix_tasks_v2_tenant_id", "tasks_v2", ["tenant_id"])
    op.create_index("ix_tasks_v2_product_code", "tasks_v2", ["product_code"])
    op.create_index("ix_tasks_v2_trigger_source", "tasks_v2", ["trigger_source"])
    op.create_index("ix_tasks_v2_executor_type", "tasks_v2", ["executor_type"])
    op.create_index("ix_tasks_v2_executor_id", "tasks_v2", ["executor_id"])
    op.create_index("ix_tasks_v2_linked_account_id", "tasks_v2", ["linked_account_id"])
    op.create_index("ix_tasks_v2_target_type", "tasks_v2", ["target_type"])
    op.create_index("ix_tasks_v2_target_id", "tasks_v2", ["target_id"])
    op.create_index("ix_tasks_v2_channel_account_id", "tasks_v2", ["channel_account_id"])
    op.create_index("ix_tasks_v2_assignment_id", "tasks_v2", ["assignment_id"])
    op.create_index("ix_tasks_v2_task_key", "tasks_v2", ["task_key"])
    op.create_index("ix_tasks_v2_status", "tasks_v2", ["status"])
    op.create_index("ix_tasks_v2_next_run_at", "tasks_v2", ["next_run_at"])

    op.create_table(
        "task_groups_v2",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", "group_id", name="uq_task_group_v2"),
    )
    op.create_index("ix_task_groups_v2_task_id", "task_groups_v2", ["task_id"])
    op.create_index("ix_task_groups_v2_group_id", "task_groups_v2", ["group_id"])

    op.create_table(
        "task_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("linked_account_id", sa.Integer(), sa.ForeignKey("linked_accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id", ondelete="SET NULL"), nullable=True),
        sa.Column("channel_account_id", sa.Integer(), sa.ForeignKey("channel_accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(32), server_default="pending"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_runs_task_id", "task_runs", ["task_id"])
    op.create_index("ix_task_runs_tenant_id", "task_runs", ["tenant_id"])
    op.create_index("ix_task_runs_linked_account_id", "task_runs", ["linked_account_id"])
    op.create_index("ix_task_runs_group_id", "task_runs", ["group_id"])
    op.create_index("ix_task_runs_channel_account_id", "task_runs", ["channel_account_id"])
    op.create_index("ix_task_runs_status", "task_runs", ["status"])
    op.create_index("ix_task_runs_started_at", "task_runs", ["started_at"])

    # =========================================================================
    # 8. Bulk messaging
    # =========================================================================
    op.create_table(
        "bulk_message_batches",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks_v2.id", ondelete="SET NULL"), nullable=True),
        sa.Column("task_run_id", sa.Integer(), sa.ForeignKey("task_runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("linked_account_id", sa.Integer(), sa.ForeignKey("linked_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_template", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), server_default="pending"),
        sa.Column("total_recipients", sa.Integer(), server_default="0"),
        sa.Column("sent_count", sa.Integer(), server_default="0"),
        sa.Column("failed_count", sa.Integer(), server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bulk_batches_tenant_id", "bulk_message_batches", ["tenant_id"])
    op.create_index("ix_bulk_batches_task_id", "bulk_message_batches", ["task_id"])
    op.create_index("ix_bulk_batches_task_run_id", "bulk_message_batches", ["task_run_id"])
    op.create_index("ix_bulk_batches_linked_account_id", "bulk_message_batches", ["linked_account_id"])
    op.create_index("ix_bulk_batches_group_id", "bulk_message_batches", ["group_id"])
    op.create_index("ix_bulk_batches_status", "bulk_message_batches", ["status"])

    op.create_table(
        "bulk_message_recipients",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("batch_id", sa.Integer(), sa.ForeignKey("bulk_message_batches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tg_user_id", sa.BigInteger(), nullable=False),
        sa.Column("username", sa.String(255), nullable=True),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("rendered_message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), server_default="pending"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("batch_id", "tg_user_id", name="uq_bulk_recipient_batch_user"),
    )
    op.create_index("ix_bulk_recipients_batch_id", "bulk_message_recipients", ["batch_id"])
    op.create_index("ix_bulk_recipients_tg_user_id", "bulk_message_recipients", ["tg_user_id"])
    op.create_index("ix_bulk_recipients_status", "bulk_message_recipients", ["status"])

    op.create_table(
        "messaging_suppression_list",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tg_user_id", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.String(64), server_default="user_opt_out"),
        sa.Column("source_group_id", sa.Integer(), sa.ForeignKey("groups.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "tg_user_id", name="uq_suppression_tenant_user"),
    )
    op.create_index("ix_suppression_tenant_id", "messaging_suppression_list", ["tenant_id"])
    op.create_index("ix_suppression_tg_user_id", "messaging_suppression_list", ["tg_user_id"])

    # =========================================================================
    # 9. Identity & membership
    # =========================================================================
    op.create_table(
        "tenant_memberships",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(32), server_default="member"),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_tenant_membership_tenant_user"),
    )
    op.create_index("ix_tenant_memberships_tenant_id", "tenant_memberships", ["tenant_id"])
    op.create_index("ix_tenant_memberships_user_id", "tenant_memberships", ["user_id"])
    op.create_index("ix_tenant_memberships_role", "tenant_memberships", ["role"])

    op.create_table(
        "user_identities",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("provider_user_id", sa.String(128), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("metadata", sa.JSON(), server_default="{}"),
        sa.Column("is_primary", sa.Boolean(), server_default="false"),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_user_id", name="uq_user_identity_provider_user"),
    )
    op.create_index("ix_user_identities_user_id", "user_identities", ["user_id"])
    op.create_index("ix_user_identities_provider", "user_identities", ["provider"])
    op.create_index("ix_user_identities_provider_user_id", "user_identities", ["provider_user_id"])

    # =========================================================================
    # 10. Unified audit logs
    # =========================================================================
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=True),
        sa.Column("actor_type", sa.String(32), server_default="system"),
        sa.Column("actor_id", sa.String(64), nullable=False),
        sa.Column("actor_tg_user_id", sa.BigInteger(), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("target_type", sa.String(32), nullable=False),
        sa.Column("target_id", sa.String(64), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_logs_tenant_id", "audit_logs", ["tenant_id"])
    op.create_index("ix_audit_logs_actor_type", "audit_logs", ["actor_type"])
    op.create_index("ix_audit_logs_actor_id", "audit_logs", ["actor_id"])
    op.create_index("ix_audit_logs_actor_tg_user_id", "audit_logs", ["actor_tg_user_id"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    op.create_index("ix_audit_logs_target_type", "audit_logs", ["target_type"])
    op.create_index("ix_audit_logs_target_id", "audit_logs", ["target_id"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])

    # =========================================================================
    # 11. MCP tokens
    # =========================================================================
    if "mcp_tokens" not in existing:
        op.create_table(
            "mcp_tokens",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tg_user_id", sa.BigInteger(), nullable=False),
            sa.Column("name", sa.String(128), nullable=False),
            sa.Column("token_hash", sa.String(128), nullable=False),
            sa.Column("token_prefix", sa.String(16), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("is_active", sa.Boolean(), server_default="true"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash"),
        )
        op.create_index("ix_mcp_tokens_tg_user_id", "mcp_tokens", ["tg_user_id"])

    # =========================================================================
    # 12. Seed plans + prices
    # =========================================================================
    op.execute("""
        INSERT INTO products (name, slug, description, is_active)
        VALUES ('Madarbot', 'madarbot', 'Telegram automation and group management platform', true)
        ON CONFLICT DO NOTHING
    """)
    op.execute("""
        INSERT INTO plans (product_id, name, slug, description, sort_order, is_active)
        VALUES
            ((SELECT id FROM products WHERE slug='madarbot'), 'Starter', 'starter', '1 linked account, 5 groups, basic features', 1, true),
            ((SELECT id FROM products WHERE slug='madarbot'), 'Business', 'business', '3 linked accounts, 50 groups, scraping + moderation', 2, true),
            ((SELECT id FROM products WHERE slug='madarbot'), 'Enterprise', 'enterprise', 'Unlimited accounts, priority support, custom integrations', 3, true)
        ON CONFLICT DO NOTHING
    """)
    op.execute("""
        INSERT INTO plan_prices (plan_id, amount, currency, interval, is_active)
        VALUES
            ((SELECT id FROM plans WHERE slug='starter'), 2900, 'USD', 'month', true),
            ((SELECT id FROM plans WHERE slug='starter'), 29000, 'USD', 'year', true),
            ((SELECT id FROM plans WHERE slug='business'), 7900, 'USD', 'month', true),
            ((SELECT id FROM plans WHERE slug='business'), 79000, 'USD', 'year', true),
            ((SELECT id FROM plans WHERE slug='enterprise'), 19900, 'USD', 'month', true),
            ((SELECT id FROM plans WHERE slug='enterprise'), 199000, 'USD', 'year', true)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.drop_table("audit_logs")
    op.drop_table("user_identities")
    op.drop_table("tenant_memberships")
    op.drop_table("messaging_suppression_list")
    op.drop_table("bulk_message_recipients")
    op.drop_table("bulk_message_batches")
    op.drop_table("task_runs")
    op.drop_table("task_groups_v2")
    op.drop_table("tasks_v2")
    op.drop_table("linked_account_groups")
    op.drop_table("linked_accounts")
    op.drop_table("checkout_sessions")
    op.drop_table("payments")
    op.drop_table("entitlements")
    op.drop_table("subscription_items")
    op.drop_table("mcp_tokens")
    op.drop_table("subscriptions")
    op.drop_table("plan_prices")
    op.drop_table("plans")
    op.drop_table("products")

    op.drop_index("ix_tenants_slug", table_name="tenants")
    op.drop_column("tenants", "settings")
    op.drop_column("tenants", "is_active")
    op.drop_column("tenants", "slug")

    op.drop_index("ix_groups_tenant_id", table_name="groups")
    op.drop_column("groups", "tenant_id")
