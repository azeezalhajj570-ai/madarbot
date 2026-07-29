from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import get_settings
from bot.db.models.system_config import SystemConfig
from bot.db.models.user_ai_config import UserAIConfig

DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"


async def get_user_ai_config(session: AsyncSession, user_id: int) -> dict[str, Any]:
    """Resolve AI config for a user.

    Priority:
    1. user_ai_config (per-user settings from dashboard)
    2. system_config (owner-level overrides)
    3. env vars (fallback defaults)
    """
    settings = get_settings()

    user_row = await session.execute(
        select(UserAIConfig).where(UserAIConfig.user_id == user_id)
    )
    user_cfg = user_row.scalar_one_or_none()

    sys_result = await session.execute(select(SystemConfig))
    sys_rows = sys_result.scalars().all()
    sys_cfg = {row.key: row.value for row in sys_rows}

    provider = (
        user_cfg.provider
        if user_cfg and user_cfg.provider != "heuristic"
        else sys_cfg.get("ai_provider", settings.ai_provider)
    )
    api_key = (
        user_cfg.api_key
        if user_cfg and user_cfg.api_key
        else sys_cfg.get("ai_provider_api_key", "")
    )
    if not api_key:
        api_key = getattr(settings, "openai_api_key", "") or ""

    model = (
        user_cfg.model
        if user_cfg and user_cfg.model
        else sys_cfg.get("ai_provider_model", settings.ai_model or "")
    )
    base_url = (
        user_cfg.base_url
        if user_cfg and user_cfg.base_url
        else sys_cfg.get("ai_provider_base_url", "")
    )
    embedding_api_key = (
        user_cfg.embedding_api_key
        if user_cfg and user_cfg.embedding_api_key
        else sys_cfg.get("ai_embedding_api_key", api_key)
    )
    embedding_model = (
        user_cfg.embedding_model
        if user_cfg
        else sys_cfg.get("ai_embedding_model", DEFAULT_EMBEDDING_MODEL)
    )
    pilot_enabled = (
        user_cfg.pilot_enabled
        if user_cfg
        else sys_cfg.get("ai_pilot_enabled", str(settings.ai_pilot_enabled).lower()) == "true"
    )

    return {
        "provider": provider,
        "api_key": api_key,
        "model": model,
        "base_url": base_url,
        "embedding_api_key": embedding_api_key,
        "embedding_model": embedding_model,
        "pilot_enabled": pilot_enabled,
    }


async def save_user_ai_config(
    session: AsyncSession, user_id: int, cfg: dict[str, Any]
) -> UserAIConfig:
    existing = await session.execute(
        select(UserAIConfig).where(UserAIConfig.user_id == user_id)
    )
    row = existing.scalar_one_or_none()
    if row is None:
        row = UserAIConfig(user_id=user_id)
        session.add(row)
    for key in ("provider", "api_key", "model", "base_url", "embedding_api_key", "embedding_model", "pilot_enabled"):
        if key in cfg:
            setattr(row, key, cfg[key])
    await session.commit()
    return row
