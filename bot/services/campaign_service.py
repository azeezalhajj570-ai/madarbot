"""Campaign CRUD service for CRM-style broadcast messaging."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from bot.agents.agent_job_service import AgentJobService
from bot.agents.dispatch import dispatch_agent_job
from bot.agents.jobs import (
    GROUP_MEMBER_BROADCAST_JOB_TYPE,
    normalize_group_member_broadcast_payload,
)
from bot.db.models import Campaign, CampaignRecurrenceLog


class CampaignService:
    VALID_TYPES = ("broadcast", "announcement", "promo", "reminder")
    VALID_STATUSES = ("draft", "scheduled", "running", "active", "paused", "completed", "cancelled")

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_campaign(
        self,
        *,
        agent_id: int,
        name: str,
        description: str | None = None,
        type: str = "broadcast",
        message_template: str | None = None,
        target_filters: dict | None = None,
        scheduled_at: datetime | None = None,
        created_by: int | None = None,
        recurrence_enabled: bool = False,
        repeat_type: str | None = None,
        interval_value: int = 1,
        repeat_time: time | None = None,
        cron_expression: str | None = None,
        end_type: str | None = None,
        end_value: str | None = None,
        timezone: str = "UTC",
    ) -> Campaign:
        if type not in self.VALID_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid campaign type '{type}'. Must be one of: {', '.join(self.VALID_TYPES)}",
            )
        campaign = Campaign(
            agent_id=agent_id,
            name=name,
            description=description,
            type=type,
            status="draft",
            message_template=message_template,
            target_filters=target_filters or {},
            created_by=created_by,
            scheduled_at=scheduled_at,
            recurrence_enabled=recurrence_enabled,
            repeat_type=repeat_type,
            interval_value=interval_value,
            repeat_time=repeat_time,
            cron_expression=cron_expression,
            end_type=end_type,
            end_value=end_value,
            timezone=timezone or "UTC",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self.session.add(campaign)
        await self.session.commit()
        await self.session.refresh(campaign)
        return campaign

    async def get_campaign(self, campaign_id: int, agent_id: int) -> Campaign:
        campaign = (
            (
                await self.session.execute(
                    select(Campaign)
                    .options(joinedload(Campaign.jobs))
                    .where(Campaign.id == campaign_id, Campaign.agent_id == agent_id)
                )
            )
            .unique()
            .scalar_one_or_none()
        )
        if campaign is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Campaign not found",
            )
        return campaign

    async def list_campaigns(
        self,
        agent_id: int,
        status: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict[str, Any]:
        query = select(Campaign).where(Campaign.agent_id == agent_id)
        count_query = select(func.count(Campaign.id)).where(Campaign.agent_id == agent_id)

        if status:
            query = query.where(Campaign.status == status)
            count_query = count_query.where(Campaign.status == status)

        total = (await self.session.execute(count_query)).scalar_one()
        pages = max(1, (total + page_size - 1) // page_size)
        offset = (page - 1) * page_size

        campaigns = (
            (
                await self.session.execute(
                    query.order_by(Campaign.created_at.desc()).offset(offset).limit(page_size)
                )
            )
            .scalars()
            .all()
        )

        return {
            "items": [self._to_dict(c) for c in campaigns],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": pages,
        }

    async def update_campaign(
        self,
        campaign_id: int,
        agent_id: int,
        *,
        name: str | None = None,
        description: str | None = None,
        type: str | None = None,
        message_template: str | None = None,
        target_filters: dict | None = None,
        scheduled_at: datetime | None = None,
        recurrence_enabled: bool | None = None,
        repeat_type: str | None = None,
        interval_value: int | None = None,
        repeat_time: time | None = None,
        cron_expression: str | None = None,
        end_type: str | None = None,
        end_value: str | None = None,
        timezone: str | None = None,
    ) -> Campaign:
        campaign = await self.get_campaign(campaign_id, agent_id)

        if campaign.status not in ("draft", "paused"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Only draft or paused campaigns can be updated",
            )

        if name is not None:
            campaign.name = name
        if description is not None:
            campaign.description = description
        if type is not None:
            if type not in self.VALID_TYPES:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Invalid campaign type '{type}'",
                )
            campaign.type = type
        if message_template is not None:
            campaign.message_template = message_template
        if target_filters is not None:
            campaign.target_filters = target_filters
        if scheduled_at is not None:
            campaign.scheduled_at = scheduled_at
        if recurrence_enabled is not None:
            campaign.recurrence_enabled = recurrence_enabled
        if repeat_type is not None:
            campaign.repeat_type = repeat_type
        if interval_value is not None:
            campaign.interval_value = interval_value
        if repeat_time is not None:
            campaign.repeat_time = repeat_time
        if cron_expression is not None:
            campaign.cron_expression = cron_expression
        if end_type is not None:
            campaign.end_type = end_type
        if end_value is not None:
            campaign.end_value = end_value
        if timezone is not None:
            campaign.timezone = timezone or "UTC"

        if campaign.recurrence_enabled:
            campaign.next_run_at = self.compute_next_run_at(campaign)

        campaign.updated_at = datetime.now(timezone.utc)
        await self.session.commit()
        await self.session.refresh(campaign)
        return campaign

    async def delete_campaign(self, campaign_id: int, agent_id: int) -> None:
        campaign = await self.get_campaign(campaign_id, agent_id)

        if campaign.status not in ("draft", "cancelled", "completed", "paused"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot delete campaign with status '{campaign.status}'. Only draft, cancelled, paused, or completed campaigns can be deleted.",
            )

        await self.session.delete(campaign)
        await self.session.commit()

    async def launch_campaign(
        self,
        campaign_id: int,
        agent_id: int,
        actor_user_id: int,
        *,
        group_ids: list[int] | None = None,
        target_type: str = "groups",
        interval_seconds: float = 3.0,
        threshold: int = 500,
    ) -> dict[str, Any]:
        campaign = await self.get_campaign(campaign_id, agent_id)

        if not campaign.message_template:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Campaign must have a message template before launching.",
            )

        resolved_group_ids = group_ids or list(
            (campaign.target_filters or {}).get("group_ids") or []
        )

        if not resolved_group_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="At least one target group is required.",
            )

        now = datetime.now(timezone.utc)
        job_service = AgentJobService(self.session)

        created_jobs: list[dict[str, Any]] = []

        for tg_group_id in resolved_group_ids:
            job_payload = normalize_group_member_broadcast_payload(
                {
                    "target_type": target_type,
                    "messages": [campaign.message_template],
                    "threshold": threshold,
                    "interval_seconds": interval_seconds,
                    "source_group_id": tg_group_id,
                    "target_group_ids": [tg_group_id] if target_type == "groups" else None,
                }
            )

            try:
                job = await job_service.create_job(
                    actor_user_id=actor_user_id,
                    agent_id=campaign.agent_id,
                    job_type=GROUP_MEMBER_BROADCAST_JOB_TYPE,
                    job_payload=job_payload,
                    campaign_id=campaign.id,
                )
                await dispatch_agent_job(job.id)
                created_jobs.append(
                    {"id": job.id, "tg_group_id": tg_group_id, "status": job.status}
                )
            except ValueError as exc:
                created_jobs.append({"id": None, "tg_group_id": tg_group_id, "error": str(exc)})

        if campaign.status == "draft":
            campaign.status = "running"
            campaign.started_at = now
        campaign.updated_at = now
        await self.session.commit()

        return {
            "status": campaign.status,
            "started_at": campaign.started_at.isoformat() if campaign.started_at else None,
            "jobs_created": len([j for j in created_jobs if j["id"] is not None]),
            "jobs_failed": len([j for j in created_jobs if j["id"] is None]),
            "jobs": created_jobs,
        }

    async def pause_campaign(self, campaign_id: int, agent_id: int) -> Campaign:
        campaign = await self.get_campaign(campaign_id, agent_id)
        if campaign.status != "active":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Only active recurring campaigns can be paused.",
            )
        campaign.status = "paused"
        campaign.updated_at = datetime.now(timezone.utc)
        await self.session.commit()
        await self.session.refresh(campaign)
        return campaign

    async def resume_campaign(self, campaign_id: int, agent_id: int) -> Campaign:
        campaign = await self.get_campaign(campaign_id, agent_id)
        if campaign.status != "paused":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Only paused campaigns can be resumed.",
            )
        campaign.status = "active"
        campaign.next_run_at = self.compute_next_run_at(campaign)
        campaign.updated_at = datetime.now(timezone.utc)
        await self.session.commit()
        await self.session.refresh(campaign)
        return campaign

    async def activate_campaign(self, campaign_id: int, agent_id: int) -> Campaign:
        campaign = await self.get_campaign(campaign_id, agent_id)
        if campaign.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Only draft campaigns can be activated.",
            )
        if not campaign.recurrence_enabled:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Only recurring campaigns can be activated.",
            )
        campaign.status = "active"
        campaign.next_run_at = self.compute_next_run_at(campaign)
        campaign.updated_at = datetime.now(timezone.utc)
        await self.session.commit()
        await self.session.refresh(campaign)
        return campaign

    async def run_now(
        self,
        campaign_id: int,
        agent_id: int,
        actor_user_id: int,
    ) -> dict[str, Any]:
        campaign = await self.get_campaign(campaign_id, agent_id)
        if campaign.status not in ("active", "paused"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Only active or paused recurring campaigns can be triggered.",
            )
        result = await self.launch_campaign(
            campaign_id=campaign_id,
            agent_id=agent_id,
            actor_user_id=actor_user_id,
        )
        return result

    async def process_due_recurring_campaigns(self, batch_size: int = 50) -> list[dict[str, Any]]:
        from sqlalchemy import update as sql_update

        now = datetime.now(timezone.utc)
        result = await self.session.execute(
            select(Campaign)
            .where(
                Campaign.recurrence_enabled == True,
                Campaign.status == "active",
                Campaign.next_run_at <= now,
                Campaign.message_template.isnot(None),
            )
            .order_by(Campaign.next_run_at)
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        )
        due = result.unique().scalars().all()
        processed: list[dict[str, Any]] = []

        for campaign in due:
            try:
                resolved_group_ids = list(
                    (campaign.target_filters or {}).get("group_ids") or []
                )
                if not resolved_group_ids:
                    continue

                job_service = AgentJobService(self.session)
                created_jobs: list[int] = []

                for tg_group_id in resolved_group_ids:
                    job_payload = normalize_group_member_broadcast_payload(
                        {
                            "target_type": "groups",
                            "messages": [campaign.message_template],
                            "threshold": 500,
                            "interval_seconds": 3.0,
                            "source_group_id": tg_group_id,
                            "target_group_ids": [tg_group_id],
                        }
                    )
                    try:
                        job = await job_service.create_job(
                            actor_user_id=campaign.created_by or 0,
                            agent_id=campaign.agent_id,
                            job_type=GROUP_MEMBER_BROADCAST_JOB_TYPE,
                            job_payload=job_payload,
                            campaign_id=campaign.id,
                        )
                        await dispatch_agent_job(job.id)
                        created_jobs.append(job.id)
                    except ValueError:
                        pass

                log_entry = CampaignRecurrenceLog(
                    campaign_id=campaign.id,
                    triggered_at=now,
                    job_id=created_jobs[0] if created_jobs else None,
                    status="sent" if created_jobs else "failed",
                    error=None if created_jobs else "No jobs created",
                    created_at=now,
                )
                self.session.add(log_entry)

                campaign.run_count = (campaign.run_count or 0) + 1
                campaign.last_run_at = now

                if campaign.end_type == "after_n_runs" and campaign.end_value:
                    try:
                        max_runs = int(campaign.end_value)
                        if campaign.run_count >= max_runs:
                            campaign.status = "completed"
                            campaign.completed_at = now
                            campaign.next_run_at = None
                        else:
                            campaign.next_run_at = self.compute_next_run_at(campaign)
                    except (ValueError, TypeError):
                        campaign.next_run_at = self.compute_next_run_at(campaign)
                elif campaign.end_type == "on_date" and campaign.end_value:
                    campaign.next_run_at = self.compute_next_run_at(campaign)
                    if campaign.next_run_at is None:
                        campaign.status = "completed"
                        campaign.completed_at = now
                else:
                    campaign.next_run_at = self.compute_next_run_at(campaign)

                campaign.updated_at = now
                processed.append({
                    "campaign_id": campaign.id,
                    "jobs_created": len(created_jobs),
                    "status": "completed",
                })
            except Exception:
                processed.append({
                    "campaign_id": campaign.id,
                    "jobs_created": 0,
                    "status": "failed",
                })

        await self.session.commit()
        return processed

    async def get_recurrence_logs(
        self,
        campaign_id: int,
        agent_id: int,
        page: int = 1,
        page_size: int = 50,
    ) -> dict[str, Any]:
        campaign = await self.get_campaign(campaign_id, agent_id)

        query = (
            select(CampaignRecurrenceLog)
            .where(CampaignRecurrenceLog.campaign_id == campaign.id)
            .order_by(desc(CampaignRecurrenceLog.triggered_at))
        )
        count_query = select(func.count(CampaignRecurrenceLog.id)).where(
            CampaignRecurrenceLog.campaign_id == campaign.id
        )

        total = (await self.session.execute(count_query)).scalar_one()
        pages = max(1, (total + page_size - 1) // page_size)
        offset = (page - 1) * page_size

        rows = (
            (await self.session.execute(query.offset(offset).limit(page_size)))
            .scalars()
            .all()
        )

        return {
            "items": [
                {
                    "id": r.id,
                    "campaign_id": r.campaign_id,
                    "triggered_at": r.triggered_at.isoformat() if r.triggered_at else None,
                    "job_id": r.job_id,
                    "status": r.status,
                    "error": r.error,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in rows
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": pages,
        }

    @staticmethod
    def compute_next_run_at(campaign: Campaign) -> datetime | None:
        if not campaign.recurrence_enabled:
            return None

        now = datetime.now(timezone.utc)
        if campaign.next_run_at and campaign.next_run_at > now:
            return campaign.next_run_at

        start_date = now.date()
        if campaign.repeat_time:
            from zoneinfo import ZoneInfo
            try:
                tz = ZoneInfo(campaign.timezone or "UTC")
            except (KeyError, TypeError):
                tz = timezone.utc
            local_now = now.astimezone(tz)
            start_date = local_now.date()

        repeat_type = campaign.repeat_type or "daily"
        interval = max(1, campaign.interval_value or 1)
        end_type = campaign.end_type

        if repeat_type == "daily":
            next_date = start_date + timedelta(days=interval)
        elif repeat_type == "weekly":
            next_date = start_date + timedelta(weeks=interval)
        elif repeat_type == "monthly":
            month = start_date.month + interval
            year = start_date.year + (month - 1) // 12
            month = ((month - 1) % 12) + 1
            day = min(start_date.day, 28)
            try:
                from calendar import monthrange
                max_day = monthrange(year, month)[1]
                day = min(start_date.day, max_day)
            except ImportError:
                pass
            next_date = date(year, month, day)
        elif repeat_type == "cron":
            return None
        else:
            return None

        if campaign.repeat_time:
            next_dt = datetime.combine(next_date, campaign.repeat_time, tzinfo=tz)
            next_dt = next_dt.astimezone(timezone.utc).replace(tzinfo=timezone.utc)
        else:
            next_dt = datetime(next_date.year, next_date.month, next_date.day, tzinfo=timezone.utc)

        if end_type == "on_date" and campaign.end_value:
            try:
                end_date = datetime.fromisoformat(campaign.end_value)
                if end_date.tzinfo is None:
                    end_date = end_date.replace(tzinfo=timezone.utc)
                if next_dt > end_date:
                    return None
            except (ValueError, TypeError):
                pass

        if end_type == "after_n_runs" and campaign.end_value:
            try:
                max_runs = int(campaign.end_value)
                if campaign.run_count >= max_runs:
                    return None
            except (ValueError, TypeError):
                pass

        return next_dt

    def _to_dict(self, campaign: Campaign) -> dict[str, Any]:
        return {
            "id": campaign.id,
            "agent_id": campaign.agent_id,
            "name": campaign.name,
            "description": campaign.description,
            "type": campaign.type,
            "status": campaign.status,
            "message_template": campaign.message_template,
            "target_filters": campaign.target_filters,
            "total_recipients": campaign.total_recipients,
            "sent_count": campaign.sent_count,
            "failed_count": campaign.failed_count,
            "skipped_count": campaign.skipped_count,
            "created_by": campaign.created_by,
            "scheduled_at": campaign.scheduled_at.isoformat() if campaign.scheduled_at else None,
            "started_at": campaign.started_at.isoformat() if campaign.started_at else None,
            "completed_at": campaign.completed_at.isoformat() if campaign.completed_at else None,
            "recurrence_enabled": campaign.recurrence_enabled,
            "repeat_type": campaign.repeat_type,
            "interval_value": campaign.interval_value,
            "repeat_time": campaign.repeat_time.isoformat() if campaign.repeat_time else None,
            "cron_expression": campaign.cron_expression,
            "end_type": campaign.end_type,
            "end_value": campaign.end_value,
            "timezone": campaign.timezone,
            "next_run_at": campaign.next_run_at.isoformat() if campaign.next_run_at else None,
            "last_run_at": campaign.last_run_at.isoformat() if campaign.last_run_at else None,
            "run_count": campaign.run_count,
            "max_runs": campaign.max_runs,
            "created_at": campaign.created_at.isoformat() if campaign.created_at else None,
            "updated_at": campaign.updated_at.isoformat() if campaign.updated_at else None,
        }
