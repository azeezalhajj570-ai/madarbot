"""Campaign CRUD API endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.session import get_session
from bot.services.campaign_service import CampaignService
from bot.services.telegram_webapp_auth import TelegramWebAppIdentity

from ..dependencies import ensure_agent_admin, get_identity

router = APIRouter(tags=["campaigns"])


def _service(session: AsyncSession) -> CampaignService:
    return CampaignService(session)


@router.post("/webapp/agents/{agent_id}/campaigns")
@router.post("/api/agents/{agent_id}/campaigns")
async def create_campaign(
    agent_id: int,
    body: dict[str, Any],
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await ensure_agent_admin(agent_id, session, identity)
    service = _service(session)
    campaign = await service.create_campaign(
        agent_id=agent_id,
        name=body.get("name", ""),
        description=body.get("description"),
        type=body.get("type", "broadcast"),
        message_template=body.get("message_template"),
        target_filters=body.get("target_filters"),
        scheduled_at=_parse_dt(body.get("scheduled_at")),
        created_by=identity.user_id,
    )
    return service._to_dict(campaign)


@router.get("/webapp/agents/{agent_id}/campaigns")
@router.get("/api/agents/{agent_id}/campaigns")
async def list_campaigns(
    agent_id: int,
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await ensure_agent_admin(agent_id, session, identity)
    return await _service(session).list_campaigns(
        agent_id=agent_id,
        status=status,
        page=page,
        page_size=page_size,
    )


@router.get("/webapp/agents/{agent_id}/campaigns/{campaign_id}")
@router.get("/api/agents/{agent_id}/campaigns/{campaign_id}")
async def get_campaign(
    agent_id: int,
    campaign_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await ensure_agent_admin(agent_id, session, identity)
    campaign = await _service(session).get_campaign(campaign_id, agent_id)
    result = _service(session)._to_dict(campaign)
    result["recent_jobs"] = [
        {
            "id": job.id,
            "tg_group_id": job.job_payload.get("source_group_id")
            or job.job_payload.get("tg_group_id"),
            "status": job.status,
            "created_at": job.created_at.isoformat() if job.created_at else None,
        }
        for job in campaign.jobs[-20:]
    ]
    return result


@router.patch("/webapp/agents/{agent_id}/campaigns/{campaign_id}")
@router.patch("/api/agents/{agent_id}/campaigns/{campaign_id}")
async def update_campaign(
    agent_id: int,
    campaign_id: int,
    body: dict[str, Any],
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await ensure_agent_admin(agent_id, session, identity)
    service = _service(session)
    campaign = await service.update_campaign(
        campaign_id=campaign_id,
        agent_id=agent_id,
        name=body.get("name"),
        description=body.get("description"),
        type=body.get("type"),
        message_template=body.get("message_template"),
        target_filters=body.get("target_filters"),
        scheduled_at=_parse_dt(body.get("scheduled_at")),
    )
    return service._to_dict(campaign)


@router.delete("/webapp/agents/{agent_id}/campaigns/{campaign_id}")
@router.delete("/api/agents/{agent_id}/campaigns/{campaign_id}")
async def delete_campaign(
    agent_id: int,
    campaign_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    await ensure_agent_admin(agent_id, session, identity)
    await _service(session).delete_campaign(campaign_id, agent_id)
    return {"status": "deleted"}


@router.post("/webapp/agents/{agent_id}/campaigns/{campaign_id}/send")
@router.post("/api/agents/{agent_id}/campaigns/{campaign_id}/send")
async def send_campaign(
    agent_id: int,
    campaign_id: int,
    body: dict[str, Any],
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await ensure_agent_admin(agent_id, session, identity)
    return await _service(session).launch_campaign(
        campaign_id=campaign_id,
        agent_id=agent_id,
        actor_user_id=identity.user_id,
        group_ids=body.get("group_ids"),
        target_type=body.get("target_type", "groups"),
        interval_seconds=body.get("interval_seconds", 3.0),
        threshold=body.get("threshold", 500),
    )


@router.get("/webapp/agents/{agent_id}/campaigns/{campaign_id}/send-logs")
@router.get("/api/agents/{agent_id}/campaigns/{campaign_id}/send-logs")
async def get_campaign_send_logs(
    agent_id: int,
    campaign_id: int,
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await ensure_agent_admin(agent_id, session, identity)
    from sqlalchemy import desc, func, select
    from bot.db.models import SentBroadcastMessage

    query = select(SentBroadcastMessage).where(SentBroadcastMessage.campaign_id == campaign_id)
    count_query = select(func.count(SentBroadcastMessage.id)).where(
        SentBroadcastMessage.campaign_id == campaign_id
    )

    if status:
        query = query.where(SentBroadcastMessage.status == status)
        count_query = count_query.where(SentBroadcastMessage.status == status)

    total = (await session.execute(count_query)).scalar_one()
    pages = max(1, (total + page_size - 1) // page_size)
    offset = (page - 1) * page_size

    rows = (
        (
            await session.execute(
                query.order_by(desc(SentBroadcastMessage.sent_at)).offset(offset).limit(page_size)
            )
        )
        .scalars()
        .all()
    )

    return {
        "items": [
            {
                "id": r.id,
                "tg_user_id": r.tg_user_id,
                "tg_group_id": r.tg_group_id,
                "message_text": r.message_text,
                "status": r.status,
                "sent_at": r.sent_at.isoformat() if r.sent_at else None,
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": pages,
    }


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None
