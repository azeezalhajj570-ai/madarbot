"""Task domain models.

A Task is a generic, product-agnostic job that belongs to a tenant.
It can target groups, channel accounts, or any other entity.
It is executed by a linked account, a bot, or the system.

Supports:
  Madarbot: scrape group, send bulk messages, auto-reply
  ModBot: delete ads, reply in group, warn/mute users
  ConnexaxBot: send/sync Evolution API messages

Design principle:
  Tenant -> Task -> TaskRun (execution history)
  Task -> TaskGroup (target groups)  OR  Task.target_type / target_id
  Task -> LinkedAccount (executor)  OR  Task.executor_id (generic)
  Task -> ChannelAccount (messaging)  OR  Task.channel_account_id
"""

from __future__ import annotations
from typing import Optional

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bot.db.base import Base


class Task(Base):
    """A scheduled or recurring automation task for a tenant.

    Generic design:
      product_code  = which product owns this task (madarbot, modbot, connexaxbot)
      trigger_source = how the task was created (manual, cron, event, api, checkout)
      executor_type = what executes it (linked_account, bot, system)
      executor_id   = generic executor reference
      target_type   = what the task acts on (group, channel, conversation, member)
      target_id     = generic target reference
      channel_account_id = for messaging-platform tasks (WhatsApp, etc.)
    """

    __tablename__ = "tasks_v2"
    __table_args__ = (
        UniqueConstraint("tenant_id", "assignment_id", name="uq_task_tenant_assignment"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)

    # --- Product & trigger ---
    product_code: Mapped[str] = mapped_column(
        String(32), nullable=False, default="madarbot", index=True
    )
    # madarbot, modbot, connexaxbot
    trigger_source: Mapped[str] = mapped_column(
        String(32), nullable=False, default="manual", index=True
    )
    # manual, cron, event, api, checkout, system

    # --- Executor (generic) ---
    executor_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="linked_account", index=True
    )
    # linked_account, bot, system, channel
    executor_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    # ID of the specific executor (linked_account.id, bot user id, etc.)
    linked_account_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("linked_accounts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # --- Target (generic) ---
    target_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="group", index=True
    )
    # group, channel, conversation, member, user, broadcast
    target_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    # Generic target reference — complements task_groups_v2 for multi-target tasks

    # --- Channel (for messaging tasks) ---
    channel_account_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("channel_accounts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # --- Identity ---
    assignment_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    task_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    # scrape_members, broadcast_message, delete_ad, send_whatsapp, auto_reply, daily_summary, etc.
    display_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    # --- State ---
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="idle", index=True)
    # idle, scheduled, running, paused, completed, failed

    # --- Scheduling ---
    schedule_type: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    # manual, cron, interval, event
    schedule_cron: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    # Cron expression (e.g. "0 9 * * *")
    interval_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # For interval-based scheduling

    # --- Configuration ---
    conditions: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # --- Limits ---
    max_runs_per_day: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    max_runs_total: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    run_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # --- Timestamps ---
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class TaskGroup(Base):
    """Many-to-many: which groups a task targets.

    For multi-group tasks like broadcast or bulk scrape.
    Single-group tasks can use Task.target_type/target_id directly.
    """

    __tablename__ = "task_groups_v2"
    __table_args__ = (UniqueConstraint("task_id", "group_id", name="uq_task_group_v2"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks_v2.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class TaskRun(Base):
    """Execution record for a task run."""

    __tablename__ = "task_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks_v2.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    linked_account_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("linked_accounts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    group_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("groups.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    channel_account_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("channel_accounts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    # pending, running, completed, failed, cancelled
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    result_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    linked_account: Mapped[Optional["LinkedAccount"]] = relationship(back_populates="task_runs")
