from __future__ import annotations

import json
from typing import Any

import aiohttp
import structlog

from bot.config import get_settings

logger = structlog.get_logger(__name__)


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
) -> str | None:
    settings = get_settings()
    provider = settings.ai_provider.lower()

    if provider == "openai":
        return await _call_openai(prompt, system_kind, max_tokens, timeout_seconds, settings)
    elif provider == "gemini":
        return await _call_gemini(prompt, max_tokens, timeout_seconds, settings)
    elif provider == "openrouter":
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
) -> str | None:
    api_key = settings.gemini_api_key
    if not api_key:
        return None
    model = settings.ai_model or settings.gemini_model
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
