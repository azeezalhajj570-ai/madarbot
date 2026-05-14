"""Queue helpers for agent jobs without importing the agent worker actor."""

from __future__ import annotations

from dramatiq.message import Message
from redis.exceptions import RedisError
import structlog
from sqlalchemy import select

from datetime import datetime, timedelta, timezone

from bot.agents.jobs import (
    JOB_STATUS_DISPATCH_STALE,
    JOB_STATUS_ENQUEUE_FAILED,
    JOB_STATUS_FAILED,
    JOB_STATUS_PENDING,
    JOB_STATUS_QUEUED,
)
from bot.db.models import AgentJob
from bot.db.session import SessionLocal
from bot.workers.app import redis_broker


logger = structlog.get_logger(__name__)

STALE_JOB_THRESHOLD_HOURS = 2


async def reconcile_stale_jobs(
    *, max_hours: int = STALE_JOB_THRESHOLD_HOURS, mark_failed: bool = False
) -> dict[str, int]:
    """Find and mark stale pending/queued jobs that were never picked up.

    Returns a dict with counts of reconciled jobs.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_hours)
    stale: list[AgentJob] = []
    async with SessionLocal() as session:
        result = await session.execute(
            select(AgentJob).where(
                AgentJob.status.in_([JOB_STATUS_PENDING, JOB_STATUS_QUEUED]),
                AgentJob.updated_at < cutoff,
            )
        )
        stale = list(result.scalars())
        target_status = JOB_STATUS_FAILED if mark_failed else JOB_STATUS_DISPATCH_STALE
        for job in stale:
            job.status = target_status
            payload = dict(job.job_payload or {})
            payload["last_error"] = f"Job stale after {max_hours}h (status={job.status})"
            job.job_payload = payload
        await session.commit()
    logger.bind(count=len(stale), target_status=target_status, max_hours=max_hours).info(
        "agent_job_stale_reconciled"
    )
    return {"reconciled": len(stale), "target_status": target_status}


async def dispatch_agent_job(job_id: int) -> None:
    async with SessionLocal() as session:
        job = (
            await session.execute(select(AgentJob).where(AgentJob.id == job_id))
        ).scalar_one_or_none()
        if job is None:
            logger.bind(job_id=job_id).warning("agent_job_missing_for_dispatch")
            return
        try:
            redis_broker.enqueue(
                Message(
                    queue_name="agent",
                    actor_name="execute_agent_job",
                    args=(job.agent_id, job.id),
                    kwargs={},
                    options={},
                )
            )
            job.status = JOB_STATUS_QUEUED
            await session.commit()
        except RedisError as exc:
            job.status = JOB_STATUS_ENQUEUE_FAILED
            payload = dict(job.job_payload or {})
            payload["last_error"] = f"Redis enqueue failed: {exc}"
            job.job_payload = payload
            await session.commit()
            logger.bind(job_id=job.id, agent_id=job.agent_id, error=str(exc)).warning(
                "agent_job_enqueue_failed"
            )
