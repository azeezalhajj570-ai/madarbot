"""Tenant membership and user identity domain models.

TenantMembership links users to tenants with roles.
UserIdentity connects a user to external auth providers (Telegram, email, etc.).

Design principle:
  Tenant (in messaging.py) → Subscription → Entitlements
  Tenant → LinkedAccount → LinkedAccountGroup → Group
  Tenant → Task → TaskRun
  User → TenantMembership → Tenant
"""

from __future__ import annotations
from typing import Optional

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from bot.db.base import Base


class TenantMembership(Base):
    """Links a user to a tenant with a specific role.

    A user can belong to multiple tenants (e.g., admin for multiple businesses).
    """

    __tablename__ = "tenant_memberships"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_tenant_membership_tenant_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="member", index=True)
    # owner, admin, member, viewer
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class UserIdentity(Base):
    """External identity providers linked to a user.

    Instead of storing tg_user_id directly on users as the primary lookup,
    this table allows multiple identity providers.

    Replaces the tg_user_id unique constraint on users.
    """

    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint("provider", "provider_user_id", name="uq_user_identity_provider_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    # telegram, email, google, github, whatsapp
    provider_user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    # For Telegram: tg_user_id as string; for email: email address
    display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
