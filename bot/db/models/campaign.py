"""Campaign domain model for CRM-style broadcast messaging."""

from __future__ import annotations
from typing import Optional

from datetime import datetime, time

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    Time,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bot.db.base import Base


class Campaign(Base):
    """Groups multiple broadcast jobs under one coordinated send.

    Tracks aggregate delivery stats and lifecycle status across all
    target groups in the campaign. Supports recurring schedules.
    """

    __tablename__ = "campaigns"

    __table_args__ = (
        Index("ix_campaigns_agent_status", "agent_id", "status"),
        Index("ix_campaigns_recurrence_next_run", "recurrence_enabled", "next_run_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), index=True)
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
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Recurrence fields
    recurrence_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    repeat_type: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    interval_value: Mapped[int] = mapped_column(Integer, default=1)
    repeat_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    cron_expression: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    end_type: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    end_value: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    next_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    run_count: Mapped[int] = mapped_column(Integer, default=0)
    max_runs: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
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
    recurrence_logs: Mapped[list["CampaignRecurrenceLog"]] = relationship(
        back_populates="campaign",
        cascade="all, delete-orphan",
    )


class CampaignRecurrenceLog(Base):
    """Records each triggered execution of a recurring campaign."""

    __tablename__ = "campaign_recurrence_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    job_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    campaign: Mapped["Campaign"] = relationship(back_populates="recurrence_logs")
