"""Whop checkout and webhook domain models.

Whop is the payment provider for the agents mini app subscriptions.

Design principle:
  WhopOrder is our own record of a sale, written *before* the buyer sees the
  checkout form so the Whop checkout can carry our ``order_id`` in its metadata
  (payments and memberships created from that checkout inherit it). The order
  links to the ``SubscriptionRequest`` row that actually gates access, so a
  webhook can extend or revoke it later.

  WhopWebhookEvent stores the delivery id of every processed webhook, because
  Whop delivers events at least once and explicitly requires ignoring duplicates.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from bot.db.base import Base


class WhopOrder(Base):
    """A checkout started from the mini app, tracked from pending to paid."""

    __tablename__ = "whop_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    tg_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    plan: Mapped[str] = mapped_column(String(32), nullable=False)
    # pending, trialing, active, past_due, cancelled, expired
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    whop_checkout_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    whop_membership_id: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, index=True
    )
    whop_payment_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    current_period_end: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    trial_end: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    subscription_request_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("subscription_requests.id", ondelete="SET NULL"), nullable=True
    )
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class WhopWebhookEvent(Base):
    """Processed webhook delivery, keyed by Whop's ``webhook-id`` header.

    The row is written in the same transaction as the fulfillment work it
    belongs to. A duplicate delivery therefore finds the row and is skipped,
    while a delivery whose work failed leaves no row and is safely retried.
    """

    __tablename__ = "whop_webhook_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    webhook_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
