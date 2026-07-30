"""Billing domain models.

Product → Plan (price catalog)
Subscription → SubscriptionItem → Entitlement (tenant lifecycle)
Payment (transaction records)

Design principle:
  Plans are the price catalog. Subscriptions are the tenant's active contract.
  Entitlements are runtime feature limits derived from a subscription.
  Payments are per-subscription and replace the old per-group payment records.
"""

from __future__ import annotations
from typing import Optional

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column

from bot.db.base import Base


class Product(Base):
    """A sellable product (e.g. 'madarbot Platform')."""

    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class Plan(Base):
    """A pricing plan belonging to a product (e.g. 'Starter', 'Business', 'Enterprise')."""

    __tablename__ = "plans"
    __table_args__ = (UniqueConstraint("product_id", "slug", name="uq_plan_product_slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class PlanPrice(Base):
    """A price point for a plan in a given currency/interval."""

    __tablename__ = "plan_prices"
    __table_args__ = (
        UniqueConstraint("plan_id", "currency", "interval", name="uq_plan_price_currency_interval"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int] = mapped_column(
        Integer, nullable=False
    )  # in smallest currency unit (cents)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    interval: Mapped[str] = mapped_column(
        String(16), nullable=False, default="month"
    )  # month, year
    stripe_price_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Subscription(Base):
    """A tenant's active (or past) subscription to a plan.

    Replaces group_subscribers + subscription_requests at the tenant level.
    A tenant can have many subscriptions over time; only one is active at a time.
    """

    __tablename__ = "subscriptions"
    __table_args__ = (
        # Only one active subscription per tenant at a time
        Index(
            "uq_subscriptions_one_active_per_tenant",
            "tenant_id",
            unique=True,
            postgresql_where="status = 'active'",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    plan_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("plans.id", ondelete="SET NULL"), nullable=True, index=True
    )
    promo_code_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("promotion_codes.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    # pending, active, past_due, cancelled, expired
    current_period_start: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    current_period_end: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    trial_end: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    stripe_subscription_id: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, index=True
    )
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class SubscriptionItem(Base):
    """A line item on a subscription (e.g. 'extra linked accounts' add-on)."""

    __tablename__ = "subscription_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subscription_id: Mapped[int] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="CASCADE"), index=True
    )
    plan_price_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("plan_prices.id", ondelete="SET NULL"), nullable=True
    )
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit_amount: Mapped[int] = mapped_column(Integer, nullable=False)  # in smallest currency unit
    stripe_subscription_item_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class PlanFeature(Base):
    """Per-plan feature template — what every subscriber to a plan gets.

    Materialized into per-subscription Entitlement rows when a Subscription
    is created or renewed. Replaces the standalone `plan_features` table
    proposed on feature/015-saas-subscription-architecture (#164), keyed to
    this Integer `plans.id` instead of a separate UUID `plans` table.
    """

    __tablename__ = "plan_features"
    __table_args__ = (
        UniqueConstraint("plan_id", "feature_key", name="uq_plan_feature_plan_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True)
    feature_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    limit_value: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # NULL = unlimited
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class FeatureUsage(Base):
    """Per-subscription usage counter, one row per feature per billing period.

    Replaces the standalone `feature_usage` table proposed on
    feature/015-saas-subscription-architecture (#164) — subscription_id
    scoped instead of raw user_id, so usage is naturally pooled across all
    members of a workspace's shared subscription.
    """

    __tablename__ = "feature_usage"
    __table_args__ = (
        UniqueConstraint(
            "subscription_id", "feature_key", "period", name="uq_feature_usage_sub_key_period"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subscription_id: Mapped[int] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="CASCADE"), index=True
    )
    feature_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    period: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    # "2026-07" (YYYY-MM)
    reset_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class Entitlement(Base):
    """Runtime feature limit or capability granted by a subscription.

    Each row is a named key-value pair scoped to a subscription.
    Examples:
      max_linked_accounts = 3
      max_groups_per_account = 50
      max_daily_tasks = 1000
      can_scrape_members = true
      can_auto_moderate = true
      can_use_ai_faq = true
    """

    __tablename__ = "entitlements"
    __table_args__ = (
        UniqueConstraint("subscription_id", "key", name="uq_entitlement_subscription_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subscription_id: Mapped[int] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(512), nullable=False)
    # Stored as string for flexibility; cast to int/bool/json as needed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class Payment(Base):
    """A payment transaction against a subscription.

    Replaces group_payment_records. Moves payments to the tenant/subscription level.
    """

    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("provider", "provider_reference", name="uq_payment_v2_provider_ref"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subscription_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(
        String(32), nullable=False
    )  # stripe, manual, telegram_stars
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    # pending, paid, failed, refunded, cancelled
    provider_reference: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, index=True
    )
    description: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class CheckoutSession(Base):
    """Ephemeral checkout session for Stripe or other payment flows.

    Replaces the role of subscription_requests for payment-initiated signups.
    """

    __tablename__ = "checkout_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True)
    tg_user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="stripe")
    provider_session_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
