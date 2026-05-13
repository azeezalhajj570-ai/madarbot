"""Bulk messaging domain models.

Supports Madarbot's bulk message feature: sending messages to many
group members at once via a linked account.

bulk_message_batches — the batch envelope (one batch = one task run)
bulk_message_recipients — individual sends within a batch
messaging_suppression_list — per-tenant opt-out list
"""

from __future__ import annotations
from typing import Optional

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from bot.db.base import Base


class BulkMessageBatch(Base):
    """A single bulk messaging run (one broadcast to many recipients).

    Linked to a task run for traceability.
    """

    __tablename__ = "bulk_message_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tasks_v2.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    task_run_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("task_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    linked_account_id: Mapped[int] = mapped_column(
        ForeignKey("linked_accounts.id", ondelete="CASCADE"),
        index=True,
    )
    group_id: Mapped[int] = mapped_column(
        ForeignKey("groups.id", ondelete="CASCADE"),
        index=True,
    )
    message_template: Mapped[str] = mapped_column(Text, nullable=False)
    # Template text with optional placeholders like {name}, {username}
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    # pending, sending, completed, failed, cancelled
    total_recipients: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class BulkMessageRecipient(Base):
    """An individual recipient within a bulk message batch."""

    __tablename__ = "bulk_message_recipients"
    __table_args__ = (
        UniqueConstraint("batch_id", "tg_user_id", name="uq_bulk_recipient_batch_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("bulk_message_batches.id", ondelete="CASCADE"),
        index=True,
    )
    tg_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    rendered_message: Mapped[str] = mapped_column(Text, nullable=False)
    # The actual message text with placeholders resolved
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    # pending, sent, failed, skipped (suppressed)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class MessagingSuppression(Base):
    """Per-tenant messaging opt-out/suppression list.

    Users who have opted out of bulk messages from a tenant.
    """

    __tablename__ = "messaging_suppression_list"
    __table_args__ = (
        UniqueConstraint("tenant_id", "tg_user_id", name="uq_suppression_tenant_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    tg_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String(64), nullable=False, default="user_opt_out")
    # user_opt_out, admin_blocked, bounced, spam_report
    source_group_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("groups.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
