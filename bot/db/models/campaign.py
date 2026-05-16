"""Campaign domain model for CRM-style broadcast messaging."""

from __future__ import annotations
from typing import Optional

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bot.db.base import Base


class Campaign(Base):
    """Groups multiple broadcast jobs under one coordinated send.

    Tracks aggregate delivery stats and lifecycle status across all
    target groups in the campaign.
    """

    __tablename__ = "campaigns"

    __table_args__ = (
        Index("ix_campaigns_agent_status", "agent_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_id: Mapped[int] = mapped_column(
        ForeignKey("agents.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False, default="broadcast", index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", index=True)
    message_template: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    target_filters: Mapped[dict] = mapped_column(JSON, default=dict)
    total_recipients: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    agent: Mapped["Agent"] = relationship(back_populates="campaigns")
    jobs: Mapped[list["AgentJob"]] = relationship(
        back_populates="campaign",
        cascade="all, delete-orphan",
    )
