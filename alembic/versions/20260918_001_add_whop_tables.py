"""whop payments for the agents mini app

Adds:
  whop_orders (a checkout started from the mini app, tracked pending -> paid,
    linked to the subscription_requests row that gates access)
  whop_webhook_events (processed webhook delivery ids, for at-least-once
    delivery idempotency)

Revision ID: 20260918_001
Revises: 20260901_001
Create Date: 2026-09-18

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260918_001"
down_revision: Union[str, None] = "20260901_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # =========================================================================
    # 1. whop_orders
    # =========================================================================
    if "whop_orders" not in inspector.get_table_names():
        op.create_table(
            "whop_orders",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("order_id", sa.String(64), nullable=False),
            sa.Column("tg_user_id", sa.BigInteger(), nullable=False),
            sa.Column(
                "tenant_id",
                sa.Integer(),
                sa.ForeignKey("tenants.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("plan", sa.String(32), nullable=False),
            sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
            sa.Column("whop_checkout_id", sa.String(255), nullable=True),
            sa.Column("whop_membership_id", sa.String(255), nullable=True),
            sa.Column("whop_payment_id", sa.String(255), nullable=True),
            sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
            sa.Column("trial_end", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column(
                "subscription_request_id",
                sa.Integer(),
                sa.ForeignKey("subscription_requests.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("metadata", sa.JSON(), nullable=True),
            sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("order_id", name="uq_whop_orders_order_id"),
        )
        op.create_index("ix_whop_orders_order_id", "whop_orders", ["order_id"])
        op.create_index("ix_whop_orders_tg_user_id", "whop_orders", ["tg_user_id"])
        op.create_index("ix_whop_orders_tenant_id", "whop_orders", ["tenant_id"])
        op.create_index("ix_whop_orders_status", "whop_orders", ["status"])
        op.create_index("ix_whop_orders_whop_membership_id", "whop_orders", ["whop_membership_id"])

    # =========================================================================
    # 2. whop_webhook_events
    # =========================================================================
    if "whop_webhook_events" not in inspector.get_table_names():
        op.create_table(
            "whop_webhook_events",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("webhook_id", sa.String(128), nullable=False),
            sa.Column("event_type", sa.String(64), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=True),
            sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("webhook_id", name="uq_whop_webhook_events_webhook_id"),
        )
        op.create_index("ix_whop_webhook_events_webhook_id", "whop_webhook_events", ["webhook_id"])
        op.create_index("ix_whop_webhook_events_event_type", "whop_webhook_events", ["event_type"])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if "whop_webhook_events" in inspector.get_table_names():
        op.drop_index("ix_whop_webhook_events_event_type", table_name="whop_webhook_events")
        op.drop_index("ix_whop_webhook_events_webhook_id", table_name="whop_webhook_events")
        op.drop_table("whop_webhook_events")

    if "whop_orders" in inspector.get_table_names():
        op.drop_index("ix_whop_orders_whop_membership_id", table_name="whop_orders")
        op.drop_index("ix_whop_orders_status", table_name="whop_orders")
        op.drop_index("ix_whop_orders_tenant_id", table_name="whop_orders")
        op.drop_index("ix_whop_orders_tg_user_id", table_name="whop_orders")
        op.drop_index("ix_whop_orders_order_id", table_name="whop_orders")
        op.drop_table("whop_orders")
