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
            logger.bind(job_id=job_id, agent_id=agent_id).exception("scheduled_job_dispatch_failed")

    await _process_recurring_campaigns()


async def _process_recurring_campaigns() -> None:
    from bot.services.campaign_service import CampaignService

    async with SessionLocal() as session:
        service = CampaignService(session)
        try:
            processed = await service.process_due_recurring_campaigns(batch_size=_BATCH_SIZE)
            for item in processed:
                logger.bind(
                    campaign_id=item["campaign_id"],
                    jobs_created=item["jobs_created"],
                    status=item["status"],
                ).info("recurring_campaign_processed")
        except Exception:
            logger.exception("recurring_campaigns_processing_failed")


async def reconcile_loop() -> None:
    settings = get_settings()
    logger.bind(
        poll_interval=settings.reconcile_poll_interval,
        enabled=settings.reconcile_enabled,
    ).info("reconcile_loop_started")
    while True:
        try:
            from bot.agents.dispatch import reconcile_stale_jobs
            from bot.services.member_claim_service import expire_stale_claims

            result = await reconcile_stale_jobs()
            if result.get("reconciled") or result.get("recovered_running"):
                logger.info("reconcile_cycle_complete", **result)

            # Auto-clean member claims that have passed their TTL so members
            # are not left marked as selected after jobs fail or abort.
            async with SessionLocal() as session:
                expired = await expire_stale_claims(session)
                await session.commit()
                if expired:
                    logger.info("stale_claims_expired_in_reconcile", count=expired)
        except Exception:
            logger.exception("reconcile_tick_failed")
        await asyncio.sleep(settings.reconcile_poll_interval)
