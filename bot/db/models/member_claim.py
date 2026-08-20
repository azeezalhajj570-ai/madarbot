"""Member claiming model for parallel bulk operations."""

from __future__ import annotations
from typing import Optional

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from bot.db.base import Base


class MemberClaim(Base):
    """Temporary reservation of a source-group member by a bulk operation.

    Ensures workspace-level concurrency: one active claim per
    (tenant_id, scraped_member_id) combination.
    """

    __tablename__ = "member_claims"
    __table_args__ = (
        Index("ix_member_claims_tenant_scraped_member", "tenant_id", "scraped_member_id"),
        Index("ix_member_claims_tenant_scraped_group", "tenant_id", "scraped_group_id"),
        Index("ix_member_claims_agent_id", "agent_id"),
        Index("ix_member_claims_status", "status"),
        Index("ix_member_claims_expires_at", "expires_at"),
        Index(
            "uq_member_claims_active_per_member",
            "tenant_id",
            "scraped_member_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    scraped_group_id: Mapped[int] = mapped_column(
        ForeignKey("scraped_groups.id", ondelete="CASCADE"), nullable=False
    )
    scraped_member_id: Mapped[int] = mapped_column(
        ForeignKey("scraped_members.id", ondelete="CASCADE"), nullable=False
    )
    agent_id: Mapped[int] = mapped_column(
        ForeignKey("agents.id", ondelete="CASCADE"), nullable=False
    )
    agent_job_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("agent_jobs.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    claimed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    released_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
