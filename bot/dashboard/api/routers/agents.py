from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

logger = logging.getLogger(__name__)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from telethon.errors import ChatAdminRequiredError

from bot.agents.account_group_membership_service import AccountGroupMembershipService
from bot.agents.agent_notification_service import AgentNotificationService
from bot.agents.account_session_service import AccountSessionService
from bot.agents.agent_job_service import AgentJobService
from bot.agents.linked_account_service import LinkedAccountService
from bot.agents.dispatch import dispatch_agent_job
from bot.agents.jobs import (
    JOB_STATUS_ABORTED,
    JOB_STATUS_COMPLETED,
    JOB_STATUS_FAILED,
    JOB_STATUS_PENDING,
    JOB_STATUS_QUEUED,
    JOB_STATUS_RUNNING,
    JOB_STATUS_SCHEDULED,
    MEMBER_ADD_JOB_TYPE,
    normalize_member_add_payload,
)
from bot.db.models import AgentJob
from bot.db.models.scraper import ScrapedMember
from bot.db.session import get_session
from bot.services.member_claim_service import claim_members
from bot.services.scraper_service import ScraperService
from bot.services.telegram_webapp_auth import TelegramWebAppIdentity

from ..dependencies import (
    WorkspaceContext,
    ensure_agent_admin,
    get_identity,
    get_workspace_context,
    require_active_subscription,
    require_active_workspace,
    require_business_plan,
)
from .auth_boundary import require_agents_boundary, require_any_boundary
from ._shared import (
    AgentJobCreateRequest,
    AgentLinkRequest,
    AgentLoginCodeRequest,
    AgentLoginPasswordRequest,
    AgentLoginStartRequest,
    BlacklistAddRequest,
    BlacklistResolveRequest,
    BulkMemberAddRequest,
    BulkPreflightRequest,
    AgentSafetyUpdateRequest,
    AgentUpdateRequest,
    LeadUpdateRequest,
    serialize_agent,
)

router = APIRouter(tags=["agents"])


@router.get("/api/agents", dependencies=[Depends(require_any_boundary(["admin", "agents"]))])
@router.get(
    "/webapp/agents/list", dependencies=[Depends(require_any_boundary(["admin", "agents"]))]
)
async def webapp_agents(
    group_id: int | None = Query(default=None, ge=1),
    workspace: WorkspaceContext = Depends(get_workspace_context),
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    agents = await LinkedAccountService(session).list_agents(
        actor_user_id=workspace.identity.user_id, group_id=group_id, tenant_id=workspace.tenant_id,
    )
    return [serialize_agent(agent) for agent in agents]


@router.post("/api/agents/link", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
@router.post("/webapp/agents/link", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
async def webapp_link_agent(
    payload: AgentLinkRequest,
    workspace: WorkspaceContext = Depends(require_active_workspace),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    # Check plan limits
    from bot.config import get_settings
    from bot.services.subscription_service import SubscriptionService

    identity = workspace.identity
    is_owner = identity.user_id in get_settings().bot_owner_ids
    if not is_owner:
        sub = await SubscriptionService(session).get_active_subscription(
            tg_user_id=identity.user_id
        )
        if sub and sub.plan == "pro":
            existing = await LinkedAccountService(session).list_agents(
                actor_user_id=identity.user_id, tenant_id=workspace.tenant_id,
            )
            if len(existing) >= 1:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Pro plan is limited to 1 linked account. Upgrade to Business for more.",
                )

    try:
        agent = await LinkedAccountService(session).create_agent(
            actor_user_id=identity.user_id,
            group_id=payload.group_id,
            external_account_id=(payload.name or payload.external_account_id),
            phone_number=payload.phone_number,
            telegram_user_id=payload.telegram_user_id,
            tenant_id=workspace.tenant_id,
            metadata={
                **payload.metadata,
                **(
                    {"display_name": payload.name.strip()}
                    if payload.name and payload.name.strip()
                    else {}
                ),
            },
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return {"status": "ok", "agent": serialize_agent(agent)}


@router.post("/api/agents/auth/start", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
@router.post("/webapp/agents/auth/start", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
async def webapp_start_agent_auth(
    payload: AgentLoginStartRequest,
    workspace: WorkspaceContext = Depends(require_active_workspace),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    try:
        agent = await AccountSessionService(session).start_agent_login(
            actor_user_id=workspace.identity.user_id,
            group_id=payload.group_id,
            phone_number=payload.phone_number,
            agent_id=payload.agent_id,
            tenant_id=workspace.tenant_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return {"status": "ok", "agent": serialize_agent(agent)}


@router.post("/api/agents/{agent_id}/auth/code", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
@router.post("/webapp/agents/{agent_id}/auth/code", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
async def webapp_complete_agent_auth_code(
    agent_id: int,
    payload: AgentLoginCodeRequest,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        updated = await AccountSessionService(session).complete_agent_code(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            code=payload.code,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return {"status": "ok", "agent": serialize_agent(updated)}


@router.post(
    "/api/agents/{agent_id}/auth/password", dependencies=[Depends(require_any_boundary(["agents", "admin"]))]
)
@router.post(
    "/webapp/agents/{agent_id}/auth/password", dependencies=[Depends(require_any_boundary(["agents", "admin"]))]
)
async def webapp_complete_agent_auth_password(
    agent_id: int,
    payload: AgentLoginPasswordRequest,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        updated = await AccountSessionService(session).complete_agent_password(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            password=payload.password,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return {"status": "ok", "agent": serialize_agent(updated)}


@router.get("/api/agents/{agent_id}/jobs", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
@router.get("/webapp/agents/{agent_id}/jobs", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
async def webapp_agent_jobs(
    agent_id: int,
    job_type: str | None = None,
    limit: int = 50,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    from sqlalchemy import select
    from bot.db.models.scraper import ScrapedGroup

    agent = await ensure_agent_admin(agent_id, session, identity)
    rows = await AgentJobService(session).list_agent_jobs(
        actor_user_id=identity.user_id,
        agent_id=agent.id,
        limit=limit,
        job_type=job_type,
    )

    tg_ids = set()
    for job in rows:
        p = job.job_payload or {}
        tgid = p.get("target_tg_group_id") or 0
        if tgid:
            tg_ids.add(int(tgid))
        for gid in (p.get("target_group_ids") or []):
            if gid:
                tg_ids.add(int(gid))

    group_titles: dict[int, str] = {}
    if tg_ids:
        groups = (
            await session.execute(
                select(ScrapedGroup).where(ScrapedGroup.tg_group_id.in_(list(tg_ids)))
            )
        ).scalars().all()
        for g in groups:
            group_titles[int(g.tg_group_id)] = g.title or ""

    return [
        {
            "id": job.id,
            "agent_id": job.agent_id,
            "job_type": job.job_type,
            "job_payload": job.job_payload,
            "status": job.status,
            "scheduled_at": job.scheduled_at.isoformat() if job.scheduled_at else None,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "updated_at": job.updated_at.isoformat() if job.updated_at else None,
            "progress": (job.job_payload or {}).get("progress"),
            "message_preview": ((job.job_payload or {}).get("message") or "")[:200],
            "target_type": (job.job_payload or {}).get("target_type", "members"),
            "source_group_title": (job.job_payload or {}).get("source_group_title") or "",
            "target_group_ids": (job.job_payload or {}).get("target_group_ids") or [],
            "selected_count": len((job.job_payload or {}).get("selected_user_ids") or []),
            "exclusion_counts": (job.job_payload or {}).get("exclusion_counts"),
            "target_tg_group_id": (job.job_payload or {}).get("target_tg_group_id"),
            "target_group_title": group_titles.get(
                int((job.job_payload or {}).get("target_tg_group_id") or 0)
            ) or "",
        }
        for job in rows
    ]


@router.get("/api/agents/{agent_id}/send-logs", dependencies=[Depends(require_agents_boundary)])
@router.get("/webapp/agents/{agent_id}/send-logs", dependencies=[Depends(require_agents_boundary)])
async def webapp_agent_send_logs(
    agent_id: int,
    limit: int = 100,
    offset_id: int | None = None,
    job_id: int | None = None,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    from sqlalchemy import desc, select
    from bot.db.models.agent import AgentJob, SentBroadcastMessage

    logs: list[dict[str, Any]] = []

    if job_id:
        job = (
            await session.execute(
                select(AgentJob).where(AgentJob.id == job_id, AgentJob.agent_id == agent.id)
            )
        ).scalar_one_or_none()

        if job and job.job_type in ("member_add", "bulk_add_members"):
            progress = dict(job.job_payload.get("progress") or {})
            results: list[dict[str, Any]] = progress.get("results", [])

            tg_user_ids = [r.get("user_id") for r in results if r.get("user_id")]
            usernames: dict[int, str] = {}
            if tg_user_ids:
                from bot.db.models.scraper import ScrapedMember
                sm_rows = (
                    await session.execute(
                        select(ScrapedMember.tg_user_id, ScrapedMember.username).where(
                            ScrapedMember.tg_user_id.in_(tg_user_ids)
                        )
                    )
                ).all()
                usernames = {int(r.tg_user_id): r.username for r in sm_rows if r.username}

            target_tg = int(progress.get("target_tg_group_id", 0))
            group_title = None
            if target_tg:
                from bot.db.models.scraper import ScrapedGroup
                grp = (
                    await session.execute(
                        select(ScrapedGroup.title).where(
                            ScrapedGroup.tg_group_id == target_tg,
                            ScrapedGroup.last_agent_id == agent.id,
                        )
                    )
                ).scalar_one_or_none()
                group_title = grp or str(target_tg)

            for i, r in enumerate(results):
                uid = r.get("user_id")
                status = r.get("status", "unknown")
                error_code = r.get("error_code")
                method = r.get("method")
                msg = status
                if error_code:
                    msg = f"{status}: {error_code}"
                elif method:
                    msg = f"{status} ({method})"

                logs.append({
                    "id": -(job.id * 10000 + i),
                    "job_id": job.id,
                    "tg_user_id": uid,
                    "tg_group_id": target_tg,
                    "username": usernames.get(uid) if uid else None,
                    "phone_number": None,
                    "group_title": group_title,
                    "message_preview": msg,
                    "message_full": msg,
                    "status": status,
                    "sent_at": job.updated_at.isoformat() if job.updated_at else None,
                })

    if not logs:
        stmt = select(SentBroadcastMessage).where(SentBroadcastMessage.agent_id == agent.id)
        if job_id:
            stmt = stmt.where(SentBroadcastMessage.job_id == job_id)
        if offset_id:
            stmt = stmt.where(SentBroadcastMessage.id < offset_id)
        stmt = stmt.order_by(desc(SentBroadcastMessage.id)).limit(limit)

        rows = (await session.execute(stmt)).scalars().all()

        group_ids = {int(msg.tg_group_id) for msg in rows if msg.tg_user_id is None}
        if group_ids:
            from bot.db.models.scraper import ScrapedGroup
            from sqlalchemy import select as sql_select

            group_rows = (
                await session.execute(
                    sql_select(ScrapedGroup.tg_group_id, ScrapedGroup.title).where(
                        ScrapedGroup.tg_group_id.in_(group_ids),
                        ScrapedGroup.last_agent_id == agent.id,
                    )
                )
            ).all()
            group_titles = {int(r.tg_group_id): r.title or str(r.tg_group_id) for r in group_rows}
        else:
            group_titles = {}

        logs = [
            {
                "id": msg.id,
                "job_id": msg.job_id,
                "tg_user_id": msg.tg_user_id,
                "tg_group_id": msg.tg_group_id,
                "username": msg.username or None,
                "phone_number": msg.phone_number or None,
                "group_title": group_titles.get(int(msg.tg_group_id))
                if msg.tg_user_id is None
                else None,
                "message_preview": (msg.message_text or "")[:200],
                "message_full": msg.message_text,
                "status": msg.status,
                "sent_at": msg.sent_at.isoformat() if msg.sent_at else None,
            }
            for msg in rows
        ]

    return {
        "logs": logs[:limit],
        "has_more": len(logs) >= limit,
    }


@router.get("/api/agents/{agent_id}/notifications", dependencies=[Depends(require_agents_boundary)])
@router.get(
    "/webapp/agents/{agent_id}/notifications", dependencies=[Depends(require_agents_boundary)]
)
async def webapp_agent_notifications(
    agent_id: int,
    limit: int = Query(default=50, ge=1, le=100),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    return await AgentNotificationService(session).list_notifications(
        actor_user_id=identity.user_id,
        agent_id=agent.id,
        limit=limit,
    )


@router.post(
    "/api/agents/{agent_id}/notifications/mark-seen",
    dependencies=[Depends(require_agents_boundary)],
)
@router.post(
    "/webapp/agents/{agent_id}/notifications/mark-seen",
    dependencies=[Depends(require_agents_boundary)],
)
async def webapp_mark_agent_notifications_seen(
    agent_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    updated = await AgentNotificationService(session).mark_all_seen(
        actor_user_id=identity.user_id,
        agent_id=agent.id,
    )
    return {"status": "ok", "updated": updated}


@router.get(
    "/api/agents/{agent_id}/status",
    dependencies=[Depends(require_any_boundary(["admin", "agents"]))],
)
@router.get(
    "/webapp/agents/{agent_id}/status",
    dependencies=[Depends(require_any_boundary(["admin", "agents"]))],
)
async def webapp_agent_status(
    agent_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    from bot.agents.session import SessionManager
    session_state = await SessionManager().get_session_state(agent.id)
    return {
        "id": agent.id,
        "phone_number": agent.phone_number,
        "status": agent.status,
        "auth_state": agent.auth_state,
        "safety_mode_enabled": agent.safety_mode_enabled,
        "safety_mode_until": agent.safety_mode_until.isoformat() if agent.safety_mode_until else None,
        **session_state,
    }


@router.post(
    "/api/agents/{agent_id}/sync-workspace", dependencies=[Depends(require_agents_boundary)]
)
@router.post(
    "/webapp/agents/{agent_id}/sync-workspace", dependencies=[Depends(require_agents_boundary)]
)
async def webapp_sync_workspace(
    agent_id: int,
    identity: TelegramWebAppIdentity = Depends(require_business_plan),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    synced = await ScraperService(session).sync_agent_groups(agent_id=agent.id)
    return {"status": "ok", "count": len(synced)}


@router.get(
    "/api/agents/{agent_id}/groups",
    dependencies=[Depends(require_any_boundary(["admin", "agents"]))],
)
@router.get(
    "/webapp/agents/{agent_id}/groups",
    dependencies=[Depends(require_any_boundary(["admin", "agents"]))],
)
async def webapp_agent_groups(
    agent_id: int,
    q: str | None = Query(default=None),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    return await AccountGroupMembershipService(session).list_managed_member_groups(
        actor_user_id=identity.user_id,
        agent_id=agent.id,
        query=q,
    )


@router.get("/api/agents/{agent_id}/member-search", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
@router.get(
    "/webapp/agents/{agent_id}/member-search", dependencies=[Depends(require_any_boundary(["agents", "admin"]))]
)
async def webapp_agent_member_search(
    agent_id: int,
    tg_group_id: int = Query(...),
    q: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=50),
    page: int = Query(default=1, ge=1),
    order_by: str = Query(default="message_count"),
    exclude_admins: bool = Query(default=False),
    exclude_bots: bool = Query(default=False),
    only_admins: bool = Query(default=False),
    only_bots: bool = Query(default=False),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        payload = await AccountGroupMembershipService(session).list_scraped_agent_group_members(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            tg_group_id=tg_group_id,
            query=q,
            page=page,
            page_size=limit,
            order_by=order_by,
            exclude_admins=exclude_admins,
            exclude_bots=exclude_bots,
            only_admins=only_admins,
            only_bots=only_bots,
        )
        return payload
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get("/api/agents/{agent_id}/target-group-members/{tg_group_id}", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
@router.get(
    "/webapp/agents/{agent_id}/target-group-members/{tg_group_id}", dependencies=[Depends(require_any_boundary(["agents", "admin"]))]
)
async def webapp_agent_target_group_members(
    agent_id: int,
    tg_group_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        return await AccountGroupMembershipService(session).fetch_and_store_target_group_members(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            tg_group_id=tg_group_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get(
    "/api/agents/{agent_id}/groups/{tg_group_id}/members",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
@router.get(
    "/webapp/agents/{agent_id}/groups/{tg_group_id}/members",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
async def webapp_agent_group_members(
    agent_id: int,
    tg_group_id: int,
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
    order_by: str = Query(default="message_count"),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        return await AccountGroupMembershipService(session).list_scraped_agent_group_members(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            tg_group_id=tg_group_id,
            query=q,
            page=page,
            page_size=page_size,
            order_by=order_by,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get(
    "/api/groups/{scraped_group_id}/stored-members",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
@router.get(
    "/webapp/groups/{scraped_group_id}/stored-members",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
async def webapp_stored_members(
    scraped_group_id: int,
    q: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    page: int = Query(default=1, ge=1),
    order_by: str = Query(default="message_count"),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from sqlalchemy import select
    from bot.db.models import ScrapedGroup

    scraped_group = (
        await session.execute(select(ScrapedGroup).where(ScrapedGroup.id == scraped_group_id))
    ).scalar_one_or_none()
    if scraped_group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scraped group not found")
    agent_id = int(scraped_group.last_agent_id) if scraped_group.last_agent_id else None
    if agent_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No agent linked to this group"
        )
    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        return await AccountGroupMembershipService(session).list_scraped_agent_group_members(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            tg_group_id=int(scraped_group.tg_group_id),
            query=q,
            page=page,
            page_size=limit,
            order_by=order_by,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.post(
    "/api/agents/{agent_id}/groups/{tg_group_id}/sync-admins-bots",
    dependencies=[Depends(require_agents_boundary)],
)
@router.post(
    "/webapp/agents/{agent_id}/groups/{tg_group_id}/sync-admins-bots",
    dependencies=[Depends(require_agents_boundary)],
)
async def webapp_sync_admins_bots(
    agent_id: int,
    tg_group_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        result = await AccountGroupMembershipService(
            session
        ).sync_group_admins_and_bots_from_telegram(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            tg_group_id=tg_group_id,
        )
        return {"status": "ok", **result}
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except ChatAdminRequiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This account must be a group admin to sync admins and bots.",
        ) from exc


@router.get(
    "/api/agents/{agent_id}/groups/{tg_group_id}/members/{user_id}/messages",
    dependencies=[Depends(require_agents_boundary)],
)
@router.get(
    "/webapp/agents/{agent_id}/groups/{tg_group_id}/members/{user_id}/messages",
    dependencies=[Depends(require_agents_boundary)],
)
async def webapp_agent_group_member_messages(
    agent_id: int,
    tg_group_id: int,
    user_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        return await AccountGroupMembershipService(
            session
        ).list_scraped_agent_group_member_messages(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            tg_group_id=tg_group_id,
            user_id=user_id,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.post(
    "/api/agents/{agent_id}/groups/{tg_group_id}/scrape-members",
    dependencies=[Depends(require_agents_boundary)],
)
@router.post(
    "/webapp/agents/{agent_id}/groups/{tg_group_id}/scrape-members",
    dependencies=[Depends(require_agents_boundary)],
)
async def webapp_agent_group_scrape_members(
    agent_id: int,
    tg_group_id: int,
    limit: int = Query(default=500, ge=1, le=1_000_000),
    message_limit: int | None = Query(default=None, ge=1, le=1_000_000),
    max_age_days: int | None = Query(default=None, ge=1, le=3650),
    identity: TelegramWebAppIdentity = Depends(require_business_plan),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        return await AccountGroupMembershipService(session).scrape_agent_member_group(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            tg_group_id=tg_group_id,
            limit=limit,
            message_limit=message_limit,
            max_age_days=max_age_days,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except ChatAdminRequiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This account must be a group admin to scrape members.",
        ) from exc


@router.patch("/api/agents/{agent_id}", dependencies=[Depends(require_agents_boundary)])
@router.patch("/webapp/agents/{agent_id}", dependencies=[Depends(require_agents_boundary)])
async def webapp_update_agent(
    agent_id: int,
    payload: AgentUpdateRequest,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        updated = await LinkedAccountService(session).update_agent(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            external_account_id=(payload.name or payload.external_account_id),
            phone_number=payload.phone_number,
            telegram_user_id=payload.telegram_user_id,
            metadata={
                **payload.metadata,
                **(
                    {"display_name": payload.name.strip()}
                    if payload.name and payload.name.strip()
                    else {}
                ),
            },
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return {"status": "ok", "agent": serialize_agent(updated)}


@router.post(
    "/api/agents/{agent_id}/jobs/bulk-preflight", dependencies=[Depends(require_agents_boundary)]
)
@router.post(
    "/webapp/agents/{agent_id}/jobs/bulk-preflight", dependencies=[Depends(require_agents_boundary)]
)
async def webapp_bulk_preflight(
    agent_id: int,
    request: Request,
    payload: BulkPreflightRequest,
    identity: TelegramWebAppIdentity = Depends(require_active_subscription),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        target_type = payload.target_type or "members"
        if target_type == "groups":
            from bot.agents.jobs import normalize_group_member_broadcast_payload

            normalized = normalize_group_member_broadcast_payload(payload.model_dump())
            return {
                "target_type": "groups",
                "total": len(normalized.get("target_group_ids", [])),
                "final_count": len(normalized.get("target_group_ids", [])),
                "admins_excluded": 0,
                "bots_excluded": 0,
                "already_sent_excluded": 0,
                "filtered_user_ids": [],
            }
        exclusions = await AgentJobService(session).compute_bulk_exclusions(
            agent=agent,
            source_group_id=payload.source_group_id,
            messages=payload.messages,
            selected_user_ids=payload.selected_user_ids,
        )
        return {**exclusions, "target_type": "members"}
    except ValueError as exc:
        logger.warning(
            "bulk_preflight_422 agent=%d body=%s error=%s",
            agent_id,
            payload.model_dump_json(),
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.post(
    "/api/agents/{agent_id}/member-adds", dependencies=[Depends(require_any_boundary(["agents", "admin"]))]
)
@router.post(
    "/webapp/agents/{agent_id}/member-adds", dependencies=[Depends(require_any_boundary(["agents", "admin"]))]
)
async def webapp_bulk_add_members(
    agent_id: int,
    payload: BulkMemberAddRequest,
    identity: TelegramWebAppIdentity = Depends(require_active_subscription),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from sqlalchemy import select as sql_select

    agent = await ensure_agent_admin(agent_id, session, identity)
    if agent.auth_state != "active":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Agent is not authenticated",
        )
    try:
        normalized = normalize_member_add_payload(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    # Resolve tg_user_ids to scraped_member_ids for claiming
    user_ids = normalized.get("user_ids", [])
    source_tg_group_id = normalized.get("source_tg_group_id")

    scraped_member_map: dict[int, int] = {}  # tg_user_id -> scraped_member_id
    scraped_group_id: int | None = None

    if user_ids and source_tg_group_id:
        # Look up scraped members for this source group
        from bot.db.models.scraper import ScrapedGroup

        sg_result = await session.execute(
            sql_select(ScrapedGroup).where(ScrapedGroup.tg_group_id == source_tg_group_id)
        )
        scraped_group = sg_result.scalar_one_or_none()
        if scraped_group:
            scraped_group_id = scraped_group.id
            sm_result = await session.execute(
                sql_select(ScrapedMember).where(
                    ScrapedMember.scraped_group_id == scraped_group.id,
                    ScrapedMember.tg_user_id.in_(user_ids),
                )
            )
            for sm in sm_result.scalars().all():
                scraped_member_map[int(sm.tg_user_id)] = sm.id

    # Create claims for members that can be resolved
    claim_result = None
    if scraped_member_map and scraped_group_id:
        claim_result = await claim_members(
            session,
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            scraped_group_id=scraped_group_id,
            member_ids=list(scraped_member_map.values()),
        )
        await session.commit()

        # Filter user_ids to only include successfully claimed members
        claimed_member_ids = set(claim_result.claimed)
        claimed_tg_user_ids = [
            uid for uid, mid in scraped_member_map.items() if mid in claimed_member_ids
        ]
        normalized["user_ids"] = claimed_tg_user_ids

        # If no members were claimed, return conflicts without creating a job
        if not claimed_tg_user_ids:
            return {
                "status": "conflicts",
                "claimed_count": 0,
                "conflicts": [
                    {
                        "scraped_member_id": c.scraped_member_id,
                        "claimed_by_agent_id": c.claimed_by_agent_id,
                        "expires_at": c.expires_at.isoformat(),
                    }
                    for c in claim_result.conflicts
                ],
            }

    try:
        job = await AgentJobService(session).create_job(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            job_type=MEMBER_ADD_JOB_TYPE,
            job_payload=normalized,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    # Store claim_ids in job payload for release on completion
    if claim_result and claim_result.claimed:
        from bot.db.models.member_claim import MemberClaim

        claim_ids_result = await session.execute(
            sql_select(MemberClaim.id).where(
                MemberClaim.agent_job_id == None,  # noqa: E711
                MemberClaim.agent_id == agent.id,
                MemberClaim.scraped_group_id == scraped_group_id,
                MemberClaim.scraped_member_id.in_(claim_result.claimed),
                MemberClaim.status == "active",
            )
        )
        claim_ids = [row[0] for row in claim_ids_result.fetchall()]
        if claim_ids:
            normalized["claim_ids"] = claim_ids
            job.job_payload = normalized
            await session.commit()

    from bot.agents.dispatch import dispatch_agent_job

    await dispatch_agent_job(job.id)

    response: dict[str, Any] = {
        "status": "ok",
        "job": {
            "id": job.id,
            "agent_id": agent.id,
            "job_type": job.job_type,
            "status": job.status,
            "user_count": len(normalized.get("user_ids", [])),
            "target_tg_group_id": normalized.get("target_tg_group_id"),
        },
    }

    # Include conflict info if there were partial conflicts
    if claim_result and claim_result.conflicts:
        response["conflicts"] = [
            {
                "scraped_member_id": c.scraped_member_id,
                "claimed_by_agent_id": c.claimed_by_agent_id,
                "expires_at": c.expires_at.isoformat(),
            }
            for c in claim_result.conflicts
        ]
        response["claimed_count"] = len(claim_result.claimed)

    return response


@router.post(
    "/api/agents/{agent_id}/jobs/check-accessibility",
    dependencies=[Depends(require_agents_boundary)],
)
@router.post(
    "/webapp/agents/{agent_id}/jobs/check-accessibility",
    dependencies=[Depends(require_agents_boundary)],
)
async def webapp_check_group_accessibility(
    agent_id: int,
    request: Request,
    payload: dict[str, Any],
    identity: TelegramWebAppIdentity = Depends(require_active_subscription),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from bot.agents.exceptions import JobValidationError

    await ensure_agent_admin(agent_id, session, identity)
    group_ids = payload.get("group_ids", [])
    if not group_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="group_ids is required",
        )
    try:
        result = await AgentJobService(session).check_broadcast_accessibility(
            actor_user_id=identity.user_id,
            agent_id=agent_id,
            group_ids=[int(gid) for gid in group_ids],
        )
        return result
    except JobValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": str(exc), **exc.details},
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get(
    "/api/agents/{agent_id}/member-operations",
    dependencies=[Depends(require_agents_boundary)],
)
@router.get(
    "/webapp/agents/{agent_id}/member-operations",
    dependencies=[Depends(require_agents_boundary)],
)
async def webapp_list_member_operations(
    agent_id: int,
    tg_group_id: int | None = None,
    status: str | None = None,
    identity: TelegramWebAppIdentity = Depends(require_active_subscription),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from bot.db.models.member_operation import MemberOperation

    await ensure_agent_admin(agent_id, session, identity)
    stmt = select(MemberOperation).where(MemberOperation.agent_id == agent_id)
    if tg_group_id is not None:
        stmt = stmt.where(MemberOperation.tg_group_id == tg_group_id)
    if status is not None:
        stmt = stmt.where(MemberOperation.status == status)
    stmt = stmt.order_by(MemberOperation.created_at.desc())
    rows = (await session.execute(stmt)).scalars().all()
    return {
        "operations": [
            {
                "id": op.id,
                "tg_group_id": op.tg_group_id,
                "tg_user_id": op.tg_user_id,
                "agent_id": op.agent_id,
                "job_id": op.job_id,
                "operation_type": op.operation_type,
                "status": op.status,
                "failure_reason": op.failure_reason,
                "invitation_link": op.invitation_link,
                "sent_at": op.sent_at.isoformat() if op.sent_at else None,
                "verified_at": op.verified_at.isoformat() if op.verified_at else None,
                "joined_at": op.joined_at.isoformat() if op.joined_at else None,
                "created_at": op.created_at.isoformat() if op.created_at else None,
            }
            for op in rows
        ],
    }


@router.post(
    "/api/agents/{agent_id}/member-operations/verify",
    dependencies=[Depends(require_agents_boundary)],
)
@router.post(
    "/webapp/agents/{agent_id}/member-operations/verify",
    dependencies=[Depends(require_agents_boundary)],
)
async def webapp_verify_member_operations(
    agent_id: int,
    identity: TelegramWebAppIdentity = Depends(require_active_subscription),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from bot.agents.session import SessionManager
    from bot.services.member_verification_service import verify_all_pending_invitations

    await ensure_agent_admin(agent_id, session, identity)
    session_manager = SessionManager()
    try:
        client = await session_manager.get_client(agent_id)
        try:
            result = await verify_all_pending_invitations(client, session, agent_id)
            return {"status": "ok", **result}
        finally:
            await client.disconnect()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Verification failed: {exc}",
        ) from exc


@router.post("/api/agents/{agent_id}/jobs", dependencies=[Depends(require_agents_boundary)])
@router.post("/webapp/agents/{agent_id}/jobs", dependencies=[Depends(require_agents_boundary)])
async def webapp_create_agent_job(
    agent_id: int,
    payload: AgentJobCreateRequest,
    identity: TelegramWebAppIdentity = Depends(require_active_subscription),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)

    # Restrict scraping jobs to business plan
    if payload.job_type in {"scraper_full_group", "sync_workspace"}:
        from bot.config import get_settings
        from bot.services.subscription_service import SubscriptionService

        is_owner = identity.user_id in get_settings().bot_owner_ids
        if not is_owner:
            sub = await SubscriptionService(session).get_active_subscription(
                tg_user_id=identity.user_id
            )
            if not sub or sub.plan != "business":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Business plan required for scraping features",
                )

    try:
        job = await AgentJobService(session).create_job(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            job_type=payload.job_type,
            job_payload=payload.job_payload,
            scheduled_at=payload.scheduled_at,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    if not payload.scheduled_at:
        await dispatch_agent_job(job.id)
    return {
        "status": "ok",
        "job": {
            "id": job.id,
            "agent_id": job.agent_id,
            "job_type": job.job_type,
            "status": job.status,
            "scheduled_at": job.scheduled_at.isoformat() if job.scheduled_at else None,
        },
    }


@router.post(
    "/api/agents/{agent_id}/jobs/{job_id}/cancel",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
@router.post(
    "/webapp/agents/{agent_id}/jobs/{job_id}/cancel",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
async def webapp_cancel_agent_job(
    agent_id: int,
    job_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    from sqlalchemy import select

    job = (
        await session.execute(select(AgentJob).where(AgentJob.id == job_id))
    ).scalar_one_or_none()
    if job is None or job.agent_id != agent.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    if job.status not in {
        JOB_STATUS_PENDING,
        JOB_STATUS_QUEUED,
        JOB_STATUS_RUNNING,
        JOB_STATUS_SCHEDULED,
    }:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Cannot cancel job in status '{job.status}'",
        )

    job.status = JOB_STATUS_ABORTED
    await session.commit()
    return {"status": "ok", "job_id": job_id, "new_status": JOB_STATUS_ABORTED}


@router.post(
    "/api/agents/{agent_id}/jobs/{job_id}/retry",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
@router.post(
    "/webapp/agents/{agent_id}/jobs/{job_id}/retry",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
async def webapp_retry_agent_job(
    agent_id: int,
    job_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    from sqlalchemy import select

    job = (
        await session.execute(select(AgentJob).where(AgentJob.id == job_id))
    ).scalar_one_or_none()
    if job is None or job.agent_id != agent.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    if job.status not in {JOB_STATUS_FAILED, JOB_STATUS_ABORTED}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Cannot retry job in status '{job.status}'",
        )

    payload = dict(job.job_payload or {})
    payload.pop("progress", None)
    payload.pop("result", None)
    payload.pop("last_error", None)
    job.job_payload = payload
    job.status = JOB_STATUS_PENDING
    await session.commit()

    await dispatch_agent_job(job.id)
    return {"status": "ok", "job_id": job_id, "new_status": JOB_STATUS_QUEUED}


@router.delete("/api/agents/{agent_id}", dependencies=[Depends(require_agents_boundary)])
@router.delete("/webapp/agents/{agent_id}", dependencies=[Depends(require_agents_boundary)])
async def webapp_delete_agent(
    agent_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    deleted = await LinkedAccountService(session).unlink_agent(
        actor_user_id=identity.user_id, agent_id=agent.id
    )
    return {"status": "ok" if deleted else "missing", "deleted": deleted}


@router.patch("/api/agents/{agent_id}/safety", dependencies=[Depends(require_agents_boundary)])
@router.patch("/webapp/agents/{agent_id}/safety", dependencies=[Depends(require_agents_boundary)])
async def webapp_update_agent_safety(
    agent_id: int,
    payload: AgentSafetyUpdateRequest,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    from datetime import datetime, timezone

    if payload.max_actions_per_hour is not None:
        agent.max_actions_per_hour = payload.max_actions_per_hour
    if payload.max_messages_per_day is not None:
        agent.max_messages_per_day = payload.max_messages_per_day
    if payload.min_delay_seconds is not None:
        agent.min_delay_seconds = payload.min_delay_seconds
    if payload.cooldown_minutes is not None:
        agent.cooldown_minutes = payload.cooldown_minutes
    if payload.safety_mode_enabled is not None:
        agent.safety_mode_enabled = payload.safety_mode_enabled
    if payload.safety_mode_hours is not None:
        agent.safety_mode_until = (
            datetime.now(timezone.utc) if payload.safety_mode_hours > 0 else None
        )
        if payload.safety_mode_hours > 0:
            from datetime import timedelta

            agent.safety_mode_until = datetime.now(timezone.utc) + timedelta(
                hours=payload.safety_mode_hours
            )
    await session.commit()
    return {"status": "ok", "agent": serialize_agent(agent)}


@router.get("/api/agents/{agent_id}/leads", dependencies=[Depends(require_agents_boundary)])
@router.get("/webapp/agents/{agent_id}/leads", dependencies=[Depends(require_agents_boundary)])
async def webapp_agent_leads(
    agent_id: int,
    status: str | None = Query(default=None),
    lead_label: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    from bot.services.agent_lead_service import AgentLeadService

    return await AgentLeadService(session).list_leads(
        agent_id=agent.id,
        status=status,
        lead_label=lead_label,
        page=page,
        page_size=page_size,
    )


@router.get("/api/agents/{agent_id}/leads/stats", dependencies=[Depends(require_agents_boundary)])
@router.get(
    "/webapp/agents/{agent_id}/leads/stats", dependencies=[Depends(require_agents_boundary)]
)
async def webapp_agent_lead_stats(
    agent_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    from bot.services.agent_lead_service import AgentLeadService

    return await AgentLeadService(session).lead_stats(agent_id=agent.id)


@router.patch(
    "/api/agents/{agent_id}/leads/{lead_id}", dependencies=[Depends(require_agents_boundary)]
)
@router.patch(
    "/webapp/agents/{agent_id}/leads/{lead_id}", dependencies=[Depends(require_agents_boundary)]
)
async def webapp_update_lead(
    agent_id: int,
    lead_id: int,
    payload: LeadUpdateRequest,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await ensure_agent_admin(agent_id, session, identity)
    from bot.services.agent_lead_service import AgentLeadService

    lead = await AgentLeadService(session).update_lead(
        lead_id=lead_id,
        status=payload.status,
        assigned_to=payload.assigned_to,
        contact_info=payload.contact_info,
        notes=payload.notes,
        lead_label=payload.lead_label,
        confidence=payload.confidence,
    )
    return {"status": "ok", "lead": AgentLeadService._serialize(lead)}


@router.delete(
    "/api/agents/{agent_id}/leads/{lead_id}", dependencies=[Depends(require_agents_boundary)]
)
@router.delete(
    "/webapp/agents/{agent_id}/leads/{lead_id}", dependencies=[Depends(require_agents_boundary)]
)
async def webapp_delete_lead(
    agent_id: int,
    lead_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await ensure_agent_admin(agent_id, session, identity)
    from bot.services.agent_lead_service import AgentLeadService

    await AgentLeadService(session).delete_lead(lead_id=lead_id)
    return {"status": "ok", "deleted": True}


@router.get("/api/agents/{agent_id}/analytics", dependencies=[Depends(require_agents_boundary)])
@router.get("/webapp/agents/{agent_id}/analytics", dependencies=[Depends(require_agents_boundary)])
async def webapp_agent_analytics(
    agent_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    agent = await ensure_agent_admin(agent_id, session, identity)
    from bot.services.agent_lead_service import AgentLeadService
    from sqlalchemy import func, select
    from bot.db.models import AgentJob, AgentNotification

    lead_stats = await AgentLeadService(session).lead_stats(agent_id=agent.id)

    from bot.agents.jobs import (
        JOB_STATUS_FAILED,
        JOB_STATUS_QUEUED,
        JOB_STATUS_RUNNING,
    )

    total_jobs = (
        await session.execute(select(func.count(AgentJob.id)).where(AgentJob.agent_id == agent.id))
    ).scalar_one()

    completed_jobs = (
        await session.execute(
            select(func.count(AgentJob.id)).where(
                AgentJob.agent_id == agent.id, AgentJob.status == JOB_STATUS_COMPLETED
            )
        )
    ).scalar_one()

    failed_jobs = (
        await session.execute(
            select(func.count(AgentJob.id)).where(
                AgentJob.agent_id == agent.id, AgentJob.status == JOB_STATUS_FAILED
            )
        )
    ).scalar_one()

    queued_jobs = (
        await session.execute(
            select(func.count(AgentJob.id)).where(
                AgentJob.agent_id == agent.id, AgentJob.status == JOB_STATUS_QUEUED
            )
        )
    ).scalar_one()

    running_jobs = (
        await session.execute(
            select(func.count(AgentJob.id)).where(
                AgentJob.agent_id == agent.id, AgentJob.status == JOB_STATUS_RUNNING
            )
        )
    ).scalar_one()

    unseen_notifications = (
        await session.execute(
            select(func.count(AgentNotification.id)).where(
                AgentNotification.agent_id == agent.id,
                AgentNotification.is_seen.is_(False),
            )
        )
    ).scalar_one()

    return {
        "agent": serialize_agent(agent),
        "leads": lead_stats,
        "jobs": {
            "total": total_jobs,
            "completed": completed_jobs,
            "failed": failed_jobs,
            "queued": queued_jobs,
            "running": running_jobs,
            "pending": total_jobs - completed_jobs - failed_jobs - queued_jobs - running_jobs,
        },
        "notifications": {
            "unseen": unseen_notifications,
        },
        "safety": {
            "max_actions_per_hour": agent.max_actions_per_hour,
            "min_delay_seconds": agent.min_delay_seconds,
            "cooldown_minutes": agent.cooldown_minutes,
            "safety_mode_enabled": agent.safety_mode_enabled,
            "safety_mode_until": agent.safety_mode_until.isoformat()
            if agent.safety_mode_until
            else None,
        },
    }


@router.post("/api/agents/jobs/reconcile-stale")
@router.post("/webapp/agents/jobs/reconcile-stale")
async def webapp_reconcile_stale_jobs(
    max_hours: int = Query(default=2, ge=1, le=168),
    mark_failed: bool = Query(default=False),
) -> dict[str, Any]:
    """Reconcile stale pending/queued agent jobs older than max_hours."""
    from bot.agents.dispatch import reconcile_stale_jobs

    return await reconcile_stale_jobs(max_hours=max_hours, mark_failed=mark_failed)


@router.get("/api/agents/{agent_id}/blacklist", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
@router.get("/webapp/agents/{agent_id}/blacklist", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
async def webapp_get_blacklist(
    agent_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from bot.agents.agent_blacklist_service import AgentBlacklistService

    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        return await AgentBlacklistService(session).list_blacklist(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/api/agents/{agent_id}/blacklist", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
@router.post("/webapp/agents/{agent_id}/blacklist", dependencies=[Depends(require_any_boundary(["agents", "admin"]))])
async def webapp_add_blacklist_entries(
    agent_id: int,
    payload: BlacklistAddRequest,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    from bot.agents.agent_blacklist_service import AgentBlacklistService

    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        return await AgentBlacklistService(session).add_entries(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            entries=[e.model_dump() for e in payload.entries],
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="One or more entries already exist in the blacklist",
        )


@router.delete(
    "/api/agents/{agent_id}/blacklist/{entry_id}",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
@router.delete(
    "/webapp/agents/{agent_id}/blacklist/{entry_id}",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
async def webapp_delete_blacklist_entry(
    agent_id: int,
    entry_id: int,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    from bot.agents.agent_blacklist_service import AgentBlacklistService

    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        deleted = await AgentBlacklistService(session).delete_entry(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            entry_id=entry_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    return {"status": "ok"}


@router.post(
    "/api/agents/{agent_id}/blacklist/resolve",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
@router.post(
    "/webapp/agents/{agent_id}/blacklist/resolve",
    dependencies=[Depends(require_any_boundary(["agents", "admin"]))],
)
async def webapp_resolve_blacklist_phones(
    agent_id: int,
    payload: BlacklistResolveRequest,
    identity: TelegramWebAppIdentity = Depends(get_identity),
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    from bot.agents.agent_blacklist_service import AgentBlacklistService

    agent = await ensure_agent_admin(agent_id, session, identity)
    try:
        return await AgentBlacklistService(session).resolve_phones(
            actor_user_id=identity.user_id,
            agent_id=agent.id,
            phones=payload.phones,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


__all__ = ["router"]
