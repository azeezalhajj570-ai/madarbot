"""Campaign CRUD service for CRM-style broadcast messaging."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from bot.agents.agent_job_service import AgentJobService
from bot.agents.dispatch import dispatch_agent_job
from bot.agents.jobs import (
    GROUP_MEMBER_BROADCAST_JOB_TYPE,
    normalize_group_member_broadcast_payload,
)
from bot.db.models import Campaign


class CampaignService:
    VALID_TYPES = ("broadcast", "announcement", "promo", "reminder")
    VALID_STATUSES = ("draft", "scheduled", "running", "paused", "completed", "cancelled")

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
    ) -> Campaign:
        campaign = await self.get_campaign(campaign_id, agent_id)

        if campaign.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Only draft campaigns can be updated",
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

        campaign.updated_at = datetime.now(timezone.utc)
        await self.session.commit()
        await self.session.refresh(campaign)
        return campaign

    async def delete_campaign(self, campaign_id: int, agent_id: int) -> None:
        campaign = await self.get_campaign(campaign_id, agent_id)

        if campaign.status not in ("draft", "cancelled", "completed"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot delete campaign with status '{campaign.status}'. Only draft, cancelled, or completed campaigns can be deleted.",
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
            "created_at": campaign.created_at.isoformat() if campaign.created_at else None,
            "updated_at": campaign.updated_at.isoformat() if campaign.updated_at else None,
        }
