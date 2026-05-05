"""Linked account domain models.

A LinkedAccount represents a connected Telegram phone number/session
(or future WhatsApp/Instagram account) that belongs to a tenant.

Design principle:
  Tenant → LinkedAccount → LinkedAccountGroup → Group
  - A tenant can have many linked accounts (controlled by entitlements)
  - A linked account can manage/scrape many groups
  - A group can be assigned to multiple linked accounts with different roles

Replaces the old `agents` and `accounts` tables.
"""

from __future__ import annotations
from typing import Optional

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bot.db.base import Base


class LinkedAccount(Base):
    """A platform account linked by a tenant (Telegram phone number session, etc.).

    Replaces: agents, accounts
    """
    __tablename__ = "linked_accounts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "provider", "external_account_id", name="uq_linked_account_tenant_provider_ext"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="telegram", index=True)
    # telegram, whatsapp, instagram (future)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    external_account_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # Telegram: phone number like "+1234567890"
    tg_user_id: Mapped[Optional[int]] = mapped_column(BigInteger, index=True, nullable=True)
    # The Telegram user ID of the linked phone account
    phone_number: Mapped[Optional[str]] = mapped_column(String(32), index=True, nullable=True)
    # Encrypted session string - NEVER log, NEVER expose in API responses
    session_string: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    phone_code_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    # active, disconnected, suspended, banned
    auth_state: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    # active, pending_2fa, awaiting_code, failed
    # Rate limiting
    max_actions_per_hour: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    max_messages_per_day: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    min_delay_seconds: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cooldown_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Safety
    safety_mode_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    safety_mode_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Metadata blob (e.g. provider-specific info)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow,
    )

    # Relationships
    groups_rel: Mapped[list["LinkedAccountGroup"]] = relationship(
        back_populates="linked_account", cascade="all, delete-orphan",
    )
    task_runs: Mapped[list["TaskRun"]] = relationship(back_populates="linked_account")


class LinkedAccountGroup(Base):
    """Many-to-many join: which groups a linked account manages/scrapes/moderates.

    Replaces: account_groups, agent.group_id (single-group FK on agents)
    """
    __tablename__ = "linked_account_groups"
    __table_args__ = (
        UniqueConstraint("linked_account_id", "group_id", name="uq_linked_account_group"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    linked_account_id: Mapped[int] = mapped_column(
        ForeignKey("linked_accounts.id", ondelete="CASCADE"), index=True,
    )
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="member", index=True)
    # member, primary, scraper, moderator, backup
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow,
    )

    # Relationships
    linked_account: Mapped[LinkedAccount] = relationship(back_populates="groups_rel")
