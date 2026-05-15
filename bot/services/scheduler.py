from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import structlog
from sqlalchemy import select, update

from bot.agents.dispatch import dispatch_agent_job
from bot.agents.jobs import JOB_STATUS_PENDING, JOB_STATUS_SCHEDULED
from bot.config import get_settings
from bot.db.models import AgentJob
from bot.db.session import SessionLocal

logger = structlog.get_logger(__name__)

_BATCH_SIZE = 50


async def scheduler_loop() -> None:
    settings = get_settings()
    logger.bind(
        poll_interval=settings.scheduler_poll_interval,
        enabled=settings.scheduler_enabled,
    ).info("scheduler_loop_started")
    while True:
        try:
            await _tick()
        except Exception:
            logger.exception("scheduler_tick_failed")
        await asyncio.sleep(settings.scheduler_poll_interval)


async def _tick() -> None:
    settings = get_settings()
    if not settings.scheduler_enabled:
        return
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        result = await session.execute(
            select(AgentJob.id, AgentJob.agent_id)
            .where(
                AgentJob.status == JOB_STATUS_SCHEDULED,
                AgentJob.scheduled_at <= now,
            )
            .order_by(AgentJob.scheduled_at)
            .limit(_BATCH_SIZE)
        )
        due = result.fetchall()
        if not due:
            return

        ids = [row.id for row in due]
        await session.execute(
            update(AgentJob)
            .where(AgentJob.id.in_(ids))
            .where(AgentJob.status == JOB_STATUS_SCHEDULED)
            .values(status=JOB_STATUS_PENDING, updated_at=now)
        )
        await session.commit()

    for row in due:
        job_id, agent_id = row.id, row.agent_id
        try:
            await dispatch_agent_job(job_id)
            logger.bind(job_id=job_id, agent_id=agent_id).info("scheduled_job_dispatched")
        except Exception:
            logger.bind(job_id=job_id, agent_id=agent_id).exception(
                "scheduled_job_dispatch_failed"
            )
