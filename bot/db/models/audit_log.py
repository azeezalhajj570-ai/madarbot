"""Audit log domain model.

Unified audit log replacing:
  - owner_audit_log
  - membership_audit
  - group_subscription_events
  - moderation_logs (for action tracking; moderation_events stays for AI detection)
"""

from __future__ import annotations
from typing import Optional

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from bot.db.base import Base


class AuditLog(Base):
    """Unified audit trail for all important actions in the system.

    Scoped to tenant for multi-tenancy. Tracks who did what to which resource.
    """

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        index=True,
        nullable=True,
    )
    actor_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="system", index=True
    )
    # user, linked_account, system, bot
    actor_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Internal ID of the actor (user.id, linked_account.id, etc.)
    actor_tg_user_id: Mapped[Optional[int]] = mapped_column(BigInteger, index=True, nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # linked_account.created, linked_account_linked, task.started, payment.paid, etc.
    target_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    # linked_account, task, subscription, group, payment, etc.
    target_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Internal ID of the target resource
    detail: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        index=True,
    )
