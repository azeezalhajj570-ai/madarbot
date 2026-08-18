"""Member operation tracking for invitation fallback and verification."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from bot.db.base import Base


class MemberOperation(Base):
    """Tracks invitation fallback operations for members that couldn't be directly added."""

    __tablename__ = "member_operations"
    __table_args__ = (
        UniqueConstraint(
            "tg_group_id",
            "tg_user_id",
            "operation_type",
            name="uq_member_operation_group_user_type",
        ),
        Index("ix_member_operation_status", "status"),
        Index("ix_member_operation_agent_id", "agent_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tg_group_id: Mapped[int] = mapped_column(BigInteger, index=True)
    tg_user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    agent_id: Mapped[int] = mapped_column(Integer, ForeignKey("agents.id"), index=True)
    job_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("agent_jobs.id"), nullable=True
    )
    operation_type: Mapped[str] = mapped_column(
        String(32), default="invite_link"
    )  # invite_link
    status: Mapped[str] = mapped_column(
        String(32), default="pending"
    )  # pending/sent/joined/failed/expired
    failure_reason: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    invitation_link: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    joined_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
