from __future__ import annotations

import json
from typing import Any

import aiohttp
import structlog

from bot.config import get_settings
from bot.db.models.system_config import SystemConfig
from bot.db.models.user_ai_config import UserAIConfig
from bot.db.session import SessionLocal

logger = structlog.get_logger(__name__)

_USER_AI_CONFIG_CACHE: dict[int, dict[str, Any]] = {}
_USER_AI_CONFIG_CACHE_TIME: dict[int, float] = {}
_SYSTEM_AI_CONFIG_CACHE: dict[str, Any] | None = None
_SYSTEM_AI_CONFIG_CACHE_TIME: float = 0.0
_CONFIG_CACHE_TTL: float = 60.0


async def get_system_ai_config(force_refresh: bool = False) -> dict[str, Any]:
    """Load global AI config from system_config table, falling back to env vars."""
    global _SYSTEM_AI_CONFIG_CACHE, _SYSTEM_AI_CONFIG_CACHE_TIME
    import time
    now = time.time()
    if not force_refresh and _SYSTEM_AI_CONFIG_CACHE is not None and (now - _SYSTEM_AI_CONFIG_CACHE_TIME) < _CONFIG_CACHE_TTL:
        return _SYSTEM_AI_CONFIG_CACHE
    result: dict[str, Any] = {
        "provider": get_settings().ai_provider,
        "api_key": None,
        "model": None,
        "base_url": None,
    }
    try:
        async with SessionLocal() as session:
            from sqlalchemy import select
            rows = (await session.execute(
                select(SystemConfig).where(SystemConfig.key.like('ai_%'))
            )).scalars().all()
            cfg = {r.key: r.value for r in rows}
            if cfg.get("ai_provider") and cfg["ai_provider"] != "heuristic":
                result["provider"] = cfg["ai_provider"]
                result["api_key"] = cfg.get("ai_provider_api_key")
                result["model"] = cfg.get("ai_provider_model")
                result["base_url"] = cfg.get("ai_provider_base_url")
    except Exception as exc:
        logger.warning("system_ai_config_load_failed", error=str(exc))
    _SYSTEM_AI_CONFIG_CACHE = result
    _SYSTEM_AI_CONFIG_CACHE_TIME = time.time()
    return result


async def clear_ai_config_cache(user_id: int | None = None) -> None:
    """Invalidate AI config cache for a user or all users."""
    global _SYSTEM_AI_CONFIG_CACHE, _SYSTEM_AI_CONFIG_CACHE_TIME
    if user_id:
        _USER_AI_CONFIG_CACHE.pop(user_id, None)
        _USER_AI_CONFIG_CACHE_TIME.pop(user_id, None)
    else:
        _USER_AI_CONFIG_CACHE.clear()
        _USER_AI_CONFIG_CACHE_TIME.clear()
        _SYSTEM_AI_CONFIG_CACHE = None
        _SYSTEM_AI_CONFIG_CACHE_TIME = 0.0
    logger.info("ai_config_cache_cleared", user_id=user_id)


async def get_user_ai_config(user_id: int | None, force_refresh: bool = False) -> dict[str, Any]:
    """Load per-user AI config from DB, falling back to system_config then env."""
    import time
    now = time.time()
    if not force_refresh and user_id and user_id in _USER_AI_CONFIG_CACHE and (now - _USER_AI_CONFIG_CACHE_TIME.get(user_id, 0)) < _CONFIG_CACHE_TTL:
        return _USER_AI_CONFIG_CACHE[user_id]

    # Start with system-level config (from system_config table or env)
    result = await get_system_ai_config(force_refresh=force_refresh)

    # Check per-user override
    if user_id:
        try:
            async with SessionLocal() as session:
                from sqlalchemy import select
                row = (await session.execute(
                    select(UserAIConfig).where(UserAIConfig.user_id == user_id)
                )).scalar_one_or_none()
                if row and row.provider != "heuristic":
                    result["provider"] = row.provider
                    if row.api_key:
                        result["api_key"] = row.api_key
                    if row.model:
                        result["model"] = row.model
                    if row.base_url:
                        result["base_url"] = row.base_url
                    _USER_AI_CONFIG_CACHE[user_id] = result
                    _USER_AI_CONFIG_CACHE_TIME[user_id] = time.time()
        except Exception as exc:
            logger.warning("user_ai_config_load_failed", user_id=user_id, error=str(exc))
    return result


def _system_prompt(kind: str) -> str:
    if kind == "json":
        return "You are an admission intelligence analyst. Return only valid JSON."
    return "You are an admission intelligence analyst."


async def call_admission_llm(
    prompt: str,
    *,
    system_kind: str = "text",
    max_tokens: int = 400,
    timeout_seconds: int = 30,
    user_id: int | None = None,
) -> str | None:
    settings = get_settings()
    user_config = await get_user_ai_config(user_id)
    provider = user_config["provider"].lower()

    if provider == "openai":
        key = user_config["api_key"] or settings.openai_api_key
        if not key:
            return None
        return await _call_openai(prompt, system_kind, max_tokens, timeout_seconds, settings)
    elif provider == "gemini":
        model = user_config["model"] or settings.gemini_model
        key = user_config["api_key"] or settings.gemini_api_key
        if not key:
            return None
        return await _call_gemini(prompt, max_tokens, timeout_seconds, settings, model_override=model)
    elif provider == "openrouter":
        key = user_config["api_key"] or settings.openrouter_api_key
        if not key:
            return None
        return await _call_openrouter(prompt, system_kind, max_tokens, timeout_seconds, settings)
    else:
        logger.warning("admission_llm_unknown_provider provider=%s", provider)
        return None


async def _call_openai(
    prompt: str,
    system_kind: str,
    max_tokens: int,
    timeout_seconds: int,
    settings: Any,
) -> str | None:
    api_key = settings.openai_api_key
    if not api_key:
        return None
    model = settings.ai_model or settings.openai_model
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _system_prompt(system_kind)},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": max_tokens,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=aiohttp.ClientTimeout(total=timeout_seconds),
            ) as resp:
                data = await resp.json()
                return (data.get("choices", [{}])[0].get("message", {}).get("content", "") or "").strip()
    except Exception as exc:
        logger.warning("admission_openai_failed error=%s", str(exc))
        return None


async def _call_gemini(
    prompt: str,
    max_tokens: int,
    timeout_seconds: int,
    settings: Any,
    model_override: str | None = None,
) -> str | None:
    api_key = settings.gemini_api_key
    if not api_key:
        return None
    model = model_override or settings.ai_model or settings.gemini_model
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": max_tokens},
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                params={"key": api_key},
                json=payload,
                timeout=aiohttp.ClientTimeout(total=timeout_seconds),
            ) as resp:
                data = await resp.json()
                return (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                    .strip()
                    or None
                )
    except Exception as exc:
        logger.warning("admission_gemini_failed error=%s", str(exc))
        return None


async def _call_openrouter(
    prompt: str,
    system_kind: str,
    max_tokens: int,
    timeout_seconds: int,
    settings: Any,
) -> str | None:
    api_key = settings.openrouter_api_key
    if not api_key:
        return None
    model = settings.ai_model or settings.openrouter_model
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if settings.openrouter_app_url:
        headers["HTTP-Referer"] = str(settings.openrouter_app_url)
    headers["X-Title"] = str(settings.openrouter_app_title)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _system_prompt(system_kind)},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": max_tokens,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=timeout_seconds),
            ) as resp:
                data = await resp.json()
                return (data.get("choices", [{}])[0].get("message", {}).get("content", "") or "").strip()
    except Exception as exc:
        logger.warning("admission_openrouter_failed error=%s", str(exc))
        return None
