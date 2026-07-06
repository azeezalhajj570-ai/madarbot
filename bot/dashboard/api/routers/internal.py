from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import get_settings
from bot.core.plugin_manager import PluginManager
from bot.core.runtime.replay import RuntimeReplayService
from bot.db.models import Group, GroupSetting, ModerationLog, PluginEnabled, Warning
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


__all__ = ["router"]
