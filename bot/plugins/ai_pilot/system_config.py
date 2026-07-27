from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.config import get_settings
from bot.db.models.system_config import SystemConfig

DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"


async def load_ai_config(session: AsyncSession) -> dict[str, Any]:
    result = await session.execute(select(SystemConfig))
    rows = result.scalars().all()
    config = {row.key: row.value for row in rows}
    settings = get_settings()

    merged = {
        "ai_provider": config.get("ai_provider", settings.ai_provider),
        "ai_provider_api_key": config.get("ai_provider_api_key", ""),
        "ai_provider_model": config.get("ai_provider_model", settings.ai_model or ""),
        "ai_provider_base_url": config.get("ai_provider_base_url", ""),
        "ai_embedding_api_key": config.get(
            "ai_embedding_api_key",
            config.get("ai_provider_api_key", settings.openai_api_key or ""),
        ),
        "ai_embedding_model": config.get("ai_embedding_model", DEFAULT_EMBEDDING_MODEL),
        "ai_embedding_base_url": config.get(
            "ai_embedding_base_url",
            config.get("ai_provider_base_url", ""),
        ),
        "ai_pilot_enabled": config.get("ai_pilot_enabled", str(settings.ai_pilot_enabled).lower()) == "true",
    }
    return merged
