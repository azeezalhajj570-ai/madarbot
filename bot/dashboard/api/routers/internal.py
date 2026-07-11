from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
import sqlalchemy as sa
from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import get_settings
from bot.core.plugin_manager import PluginManager
from bot.core.runtime.replay import RuntimeReplayService
from bot.db.models import Group, GroupSetting, ModerationLog, PluginEnabled, Warning, AgentJob
from bot.db.session import get_session
from bot.services.plugin_service import PluginService
from bot.services.settings_service import SettingsService
from bot.services.telegram_webapp_auth import TelegramWebAppIdentity

from ..dependencies import get_identity
from ._shared import PluginToggleRequest

router = APIRouter(tags=["internal"])
plugin_manager = PluginManager()


async def _require_bot_owner(
    identity: TelegramWebAppIdentity = Depends(get_identity),
) -> TelegramWebAppIdentity:
    if identity.user_id not in get_settings().bot_owner_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bot owner access required",
        )
    return identity


@router.get("/favicon.ico")
async def favicon() -> Response:
    return Response(status_code=204)


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/system-health")
async def system_health(
    session: AsyncSession = Depends(get_session),
    _: TelegramWebAppIdentity = Depends(_require_bot_owner),
) -> dict[str, Any]:
    checks: dict[str, Any] = {}
    overall = "ok"

    now = datetime.now(timezone.utc)

    # Database check
    try:
        import asyncio

        start = asyncio.get_event_loop().time()
        await session.execute(select(1))
        db_latency = asyncio.get_event_loop().time() - start
        checks["database"] = {"status": "ok", "latency_ms": round(db_latency * 1000, 1)}
    except Exception as e:
        checks["database"] = {"status": "down", "detail": str(e)}
        overall = "down"

    # Redis check
    try:
        from bot.dashboard.api.main import app

        redis = getattr(app.state, "redis", None)
        if redis is not None:
            start = asyncio.get_event_loop().time()
            await redis.ping()
            redis_latency = asyncio.get_event_loop().time() - start
            checks["redis"] = {"status": "ok", "latency_ms": round(redis_latency * 1000, 1)}
        else:
            checks["redis"] = {"status": "unknown", "detail": "Redis not initialized"}
    except Exception as e:
        checks["redis"] = {"status": "down", "detail": str(e)}
        if overall != "down":
            overall = "degraded"

    # Bot worker presence
    try:
        redis = getattr(app.state, "redis", None)
        bot_last_seen = None
        if redis is not None:
            bot_ts = await redis.get("bot:worker:last_seen")
            if bot_ts:
                bot_last_seen = bot_ts
                last_seen_dt = datetime.fromtimestamp(float(bot_ts), tz=timezone.utc)
                if (now - last_seen_dt).total_seconds() < 120:
                    checks["bot_worker"] = {"status": "ok", "last_seen": bot_last_seen}
                else:
                    checks["bot_worker"] = {
                        "status": "stale",
                        "last_seen": bot_last_seen,
                        "detail": "Last seen > 2 minutes ago",
                    }
                    if overall == "ok":
                        overall = "degraded"
            else:
                checks["bot_worker"] = {"status": "unknown", "detail": "No presence key in Redis"}
    except Exception as e:
        checks["bot_worker"] = {"status": "unknown", "detail": str(e)}

    # Agent worker presence
    try:
        redis = getattr(app.state, "redis", None)
        agent_last_seen = None
        if redis is not None:
            agent_ts = await redis.get("agent:worker:last_seen")
            if agent_ts:
                agent_last_seen = agent_ts
                last_seen_dt = datetime.fromtimestamp(float(agent_ts), tz=timezone.utc)
                if (now - last_seen_dt).total_seconds() < 120:
                    checks["agent_worker"] = {"status": "ok", "last_seen": agent_last_seen}
                else:
                    checks["agent_worker"] = {
                        "status": "stale",
                        "last_seen": agent_last_seen,
                        "detail": "Last seen > 2 minutes ago",
                    }
                    if overall == "ok":
                        overall = "degraded"
            else:
                checks["agent_worker"] = {"status": "unknown", "detail": "No presence key in Redis"}
    except Exception as e:
        checks["agent_worker"] = {"status": "unknown", "detail": str(e)}

    # Queue stats
    try:
        status_counts = (
            await session.execute(
                select(AgentJob.status, func.count(AgentJob.id)).group_by(AgentJob.status)
            )
        ).all()
        jobs_by_status = {row.status: row[1] for row in status_counts}
        pending = jobs_by_status.get("pending", 0) + jobs_by_status.get("queued", 0)
        running = jobs_by_status.get("running", 0)
        failed = jobs_by_status.get("failed", 0)
        total = sum(jobs_by_status.values())

        threshold_hours = get_settings().stuck_job_threshold_hours
        stuck_cutoff = now - timedelta(hours=threshold_hours)
        stuck = (
            await session.execute(
                select(func.count(AgentJob.id)).where(
                    AgentJob.status == "running", AgentJob.updated_at < stuck_cutoff
                )
            )
        ).scalar_one()

        checks["queue"] = {
            "status": "ok" if pending < 50 else "degraded",
            "jobs_by_status": jobs_by_status,
            "total": total,
            "pending": pending,
            "running": running,
            "stuck": int(stuck or 0),
        }
        if pending >= 50 and overall == "ok":
            overall = "degraded"
    except Exception as e:
        checks["queue"] = {"status": "unknown", "detail": str(e)}

    # Recent failures (24h)
    try:
        cutoff_24h = now - timedelta(hours=24)
        failed_jobs_24h = (
            await session.execute(
                select(AgentJob.id, AgentJob.agent_id, AgentJob.job_type, AgentJob.updated_at).where(
                    AgentJob.status == "failed", AgentJob.updated_at > cutoff_24h
                ).order_by(AgentJob.updated_at.desc()).limit(20)
            )
        ).all()
        checks["recent_failures_24h"] = {
            "count": len(failed_jobs_24h),
            "jobs": [
                {
                    "id": row.id,
                    "agent_id": row.agent_id,
                    "job_type": row.job_type,
                    "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                }
                for row in failed_jobs_24h
            ],
        }
    except Exception as e:
        checks["recent_failures_24h"] = {"count": 0, "detail": str(e)}

    return {
        "status": overall,
        "checks": checks,
        "timestamp": now.isoformat(),
    }


@router.get("/groups")
async def list_groups(
    session: AsyncSession = Depends(get_session),
    _: TelegramWebAppIdentity = Depends(_require_bot_owner),
) -> list[dict[str, Any]]:
    rows = (await session.execute(select(Group.id, Group.title, Group.tg_group_id))).all()
    return [{"id": row.id, "title": row.title, "tg_group_id": row.tg_group_id} for row in rows]


@router.get("/groups/{group_id}/warnings")
async def group_warnings(
    group_id: int,
    session: AsyncSession = Depends(get_session),
    _: TelegramWebAppIdentity = Depends(_require_bot_owner),
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(Warning.user_id, Warning.reason, Warning.count, Warning.created_at).where(
                Warning.group_id == group_id
            )
        )
    ).all()
    return [
        {
            "user_id": row.user_id,
            "reason": row.reason,
            "count": row.count,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


@router.get("/groups/{group_id}/logs")
async def group_logs(
    group_id: int,
    session: AsyncSession = Depends(get_session),
    _: TelegramWebAppIdentity = Depends(_require_bot_owner),
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(
                ModerationLog.action,
                ModerationLog.target_user_id,
                ModerationLog.reason,
                ModerationLog.created_at,
            ).where(ModerationLog.group_id == group_id)
        )
    ).all()
    return [
        {
            "action": row.action,
            "target_user_id": row.target_user_id,
            "reason": row.reason,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


@router.get("/groups/{group_id}/runtime-audits")
async def group_runtime_audits(
    group_id: int,
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
    _: TelegramWebAppIdentity = Depends(_require_bot_owner),
) -> list[dict[str, Any]]:
    records = await RuntimeReplayService(session).list_records(group_id=group_id, limit=limit)
    return [record.to_dict() for record in records]


@router.get("/runtime-audits/{log_id}")
async def runtime_audit_detail(
    log_id: int,
    session: AsyncSession = Depends(get_session),
    _: TelegramWebAppIdentity = Depends(_require_bot_owner),
) -> dict[str, Any]:
    record = await RuntimeReplayService(session).get_record(log_id=log_id)
    if record is None:
        return {}
    return record.to_dict()


@router.get("/groups/{group_id}/plugins")
async def group_plugins(
    group_id: int,
    session: AsyncSession = Depends(get_session),
    _: TelegramWebAppIdentity = Depends(_require_bot_owner),
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(PluginEnabled.plugin_name, PluginEnabled.enabled).where(
                PluginEnabled.group_id == group_id
            )
        )
    ).all()
    return [{"plugin_name": row.plugin_name, "enabled": row.enabled} for row in rows]


@router.get("/settings/schema")
async def settings_schema(
    _: TelegramWebAppIdentity = Depends(_require_bot_owner),
) -> dict[str, list[dict[str, Any]]]:
    catalog = plugin_manager.discover_schema_catalog()
    return {plugin: [entry.model_dump() for entry in schema] for plugin, schema in catalog.items()}


@router.get("/settings/{group_id}")
async def group_settings(
    group_id: int,
    session: AsyncSession = Depends(get_session),
    _: TelegramWebAppIdentity = Depends(_require_bot_owner),
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(GroupSetting.key, GroupSetting.value, GroupSetting.updated_at).where(
                GroupSetting.group_id == group_id
            )
        )
    ).all()
    return [
        {
            "key": row.key,
            "value": SettingsService.unwrap_value(row.value),
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
        for row in rows
    ]


@router.post("/plugins/enable")
async def enable_plugin(
    payload: PluginToggleRequest,
    session: AsyncSession = Depends(get_session),
    _: TelegramWebAppIdentity = Depends(_require_bot_owner),
) -> dict[str, str]:
    await PluginService(session).set_enabled(payload.group_id, payload.plugin_name, payload.enabled)
    return {"status": "ok"}


ALLOWED_PROVIDER_URLS: dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/models",
    "openrouter": "https://openrouter.ai/api/v1",
}


@router.post("/pilot/test")
async def test_ai_pilot(
    payload: dict[str, Any],
    _: TelegramWebAppIdentity = Depends(_require_bot_owner),
) -> dict[str, Any]:
    provider_name = str(payload.get("provider") or get_settings().ai_provider).strip().lower()

    settings = get_settings()
    if provider_name == "openai":
        api_key = settings.openai_api_key or ""
    elif provider_name == "gemini":
        api_key = settings.gemini_api_key or ""
    elif provider_name == "openrouter":
        api_key = settings.openrouter_api_key or ""
    else:
        api_key = ""

    if not api_key:
        raise HTTPException(status_code=400, detail="No API key configured")

    provider_url = ALLOWED_PROVIDER_URLS.get(provider_name)
    if not provider_url:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider_name}")

    model = str(payload.get("model") or "").strip()
    from bot.plugins.ai_pilot.provider import (
        AIPilotError,
        GeminiPilotProvider,
        HeuristicPilotProvider,
        OpenAIPilotProvider,
        OpenRouterPilotProvider,
    )

    if provider_name == "openai":
        provider = OpenAIPilotProvider(api_key, model or "gpt-4.1-mini", provider_url)
    elif provider_name == "gemini":
        provider = GeminiPilotProvider(api_key, model or "gemini-1.5-flash", provider_url)
    elif provider_name == "openrouter":
        provider = OpenRouterPilotProvider(
            api_key, model or "google/gemini-2.0-flash-001", provider_url
        )
    else:
        provider = HeuristicPilotProvider()

    try:
        reply = await provider.chat(
            messages=[{"role": "user", "content": "Hello! Say hi back in one short sentence."}],
            model=model or None,
        )
        return {"status": "ok", "reply": reply}
    except AIPilotError as exc:
        return {"status": "error", "error": str(exc)}
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


@router.get("/admin-overview")
async def admin_overview(
    session: AsyncSession = Depends(get_session),
    _: TelegramWebAppIdentity = Depends(_require_bot_owner),
) -> dict[str, Any]:
    result: dict[str, Any] = {}

    now = datetime.now(timezone.utc)

    # ── System health (inline, no Redis dependency) ──────────────────────
    checks: dict[str, Any] = {}
    overall = "ok"

    try:
        import asyncio
        start = asyncio.get_event_loop().time()
        await session.execute(select(1))
        db_latency = asyncio.get_event_loop().time() - start
        checks["database"] = {"status": "ok", "latency_ms": round(db_latency * 1000, 1)}
    except Exception as e:
        checks["database"] = {"status": "down", "detail": str(e)}
        overall = "down"

    try:
        from bot.dashboard.api.main import app
        redis = getattr(app.state, "redis", None)
        if redis is not None:
            start = asyncio.get_event_loop().time()
            await redis.ping()
            redis_latency = asyncio.get_event_loop().time() - start
            checks["redis"] = {"status": "ok", "latency_ms": round(redis_latency * 1000, 1)}
        else:
            checks["redis"] = {"status": "unknown"}
    except Exception as e:
        checks["redis"] = {"status": "down", "detail": str(e)}
        if overall != "down":
            overall = "degraded"

    # Workers
    try:
        from bot.dashboard.api.main import app
        redis = getattr(app.state, "redis", None)
        for worker_key, worker_name in [("bot:worker:last_seen", "bot_worker"), ("agent:worker:last_seen", "agent_worker")]:
            if redis is not None:
                ts = await redis.get(worker_key)
                if ts:
                    last_seen_dt = datetime.fromtimestamp(float(ts), tz=timezone.utc)
                    if (now - last_seen_dt).total_seconds() < 120:
                        checks[worker_name] = {"status": "ok", "last_seen": ts}
                    else:
                        checks[worker_name] = {"status": "stale", "last_seen": ts}
                        if overall == "ok":
                            overall = "degraded"
                else:
                    checks[worker_name] = {"status": "unknown"}
            else:
                checks[worker_name] = {"status": "unknown"}
    except Exception:
        checks["bot_worker"] = checks.get("bot_worker", {"status": "unknown"})
        checks["agent_worker"] = checks.get("agent_worker", {"status": "unknown"})

    # Queue
    try:
        from bot.db.models import AgentJob as AJ
        status_rows = (
            await session.execute(
                select(AJ.status, func.count(AJ.id)).group_by(AJ.status)
            )
        ).all()
        jobs_by_status = {row.status: row[1] for row in status_rows}
        pending = jobs_by_status.get("pending", 0) + jobs_by_status.get("queued", 0)
        running = jobs_by_status.get("running", 0)
        stuck_cutoff = now - timedelta(hours=get_settings().stuck_job_threshold_hours)
        stuck = (
            await session.execute(
                select(func.count(AJ.id)).where(AJ.status == "running", AJ.updated_at < stuck_cutoff)
            )
        ).scalar_one()
        checks["queue"] = {
            "status": "ok" if pending < 50 else "degraded",
            "pending": pending,
            "running": running,
            "stuck": int(stuck or 0),
        }
        if pending >= 50 and overall == "ok":
            overall = "degraded"
    except Exception:
        checks["queue"] = {"status": "unknown"}

    result["system_health"] = {"status": overall, **checks}

    # ── Agents with stats ────────────────────────────────────────────────
    from bot.db.models import Agent, SentBroadcastMessage

    agents_rows = (await session.execute(select(Agent))).scalars().all()
    agent_list = []
    for a in agents_rows:
        sent_count = (
            await session.execute(
                select(func.count(SentBroadcastMessage.id)).where(
                    SentBroadcastMessage.sender_tg_user_id == a.telegram_user_id,
                    SentBroadcastMessage.status == "sent",
                )
            )
        ).scalar_one()
        unique_contacts = (
            await session.execute(
                select(func.count(func.distinct(SentBroadcastMessage.tg_user_id))).where(
                    SentBroadcastMessage.sender_tg_user_id == a.telegram_user_id,
                    SentBroadcastMessage.status == "sent",
                )
            )
        ).scalar_one()
        jobs_count = (
            await session.execute(
                select(func.count(AJ.id)).where(AJ.agent_id == a.id)
            )
        ).scalar_one()
        last_job = (
            await session.execute(
                select(AJ.created_at).where(AJ.agent_id == a.id).order_by(AJ.created_at.desc()).limit(1)
            )
        ).scalar_one_or_none()

        agent_list.append({
            "id": a.id,
            "phone": a.phone_number or a.external_account_id,
            "status": a.status,
            "telegram_user_id": a.telegram_user_id,
            "total_sent": int(sent_count or 0),
            "unique_contacts": int(unique_contacts or 0),
            "jobs_count": int(jobs_count or 0),
            "last_job_at": last_job.isoformat() if last_job else None,
        })
    result["agents"] = agent_list

    # ── Jobs summary ─────────────────────────────────────────────────────
    from bot.db.models import AgentJob

    total_jobs = (await session.execute(select(func.count(AJ.id)))).scalar_one()
    job_status_rows = (
        await session.execute(select(AJ.status, func.count(AJ.id)).group_by(AJ.status))
    ).all()
    by_status = {row.status: row[1] for row in job_status_rows}

    result["jobs_summary"] = {
        "total": int(total_jobs or 0),
        "by_status": by_status,
    }

    # ── Recent jobs (last 10) ────────────────────────────────────────────
    recent = (
        await session.execute(
            select(AJ.id, AJ.agent_id, AJ.job_type, AJ.status, AJ.created_at, AJ.updated_at)
            .order_by(AJ.created_at.desc()).limit(10)
        )
    ).all()
    result["recent_jobs"] = [
        {
            "job_id": row.id,
            "agent_id": row.agent_id,
            "job_type": row.job_type,
            "status": row.status,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in recent
    ]

    # ── Recent failures (last 24h) ───────────────────────────────────────
    cutoff_24h = now - timedelta(hours=24)
    failures = (
        await session.execute(
            select(AJ.id, AJ.agent_id, AJ.job_type, AJ.status, AJ.created_at)
            .where(AJ.status.in_(["failed", "aborted"]), AJ.updated_at > cutoff_24h)
            .order_by(AJ.updated_at.desc()).limit(10)
        )
    ).all()
    result["recent_failures"] = [
        {
            "job_id": row.id,
            "agent_id": row.agent_id,
            "job_type": row.job_type,
            "status": row.status,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in failures
    ]

    return result


__all__ = ["router"]
