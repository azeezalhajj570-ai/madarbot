"""AI chat providers for the AI Pilot plugin."""

from __future__ import annotations

from typing import Any

import httpx
import structlog

from bot.config import get_settings

logger = structlog.get_logger(__name__)

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful, concise, and truthful AI assistant. "
    "Answer the user's questions directly and accurately. "
    "If you don't know something, say so honestly. "
    "Keep responses friendly but professional. "
    "Do not make up information or provide medical, legal, or financial advice."
)

FALLBACK_REPLY = "I'm currently unable to process your request. Please try again later."


class AIPilotError(RuntimeError):
    pass


class BasePilotProvider:
    async def chat(
        self,
        messages: list[dict[str, str]],
        system_prompt: str | None = None,
        model: str | None = None,
    ) -> str:
        raise NotImplementedError


class OpenAIPilotProvider(BasePilotProvider):
    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4.1-mini",
        base_url: str = "https://api.openai.com/v1",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")

    async def chat(
        self,
        messages: list[dict[str, str]],
        system_prompt: str | None = None,
        model: str | None = None,
    ) -> str:
        resolved_model = model or self.model
        effective_system = system_prompt or DEFAULT_SYSTEM_PROMPT

        api_messages: list[dict[str, str]] = [{"role": "system", "content": effective_system}]
        api_messages.extend(messages)

        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {
            "model": resolved_model,
            "messages": api_messages,
            "max_tokens": 1024,
            "temperature": 0.7,
        }

        settings = get_settings()
        timeout = settings.ai_request_timeout_seconds

        url = f"{self.base_url}/chat/completions"

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=payload)

        if response.status_code >= 400:
            logger.warning(
                "ai_pilot_openai_error",
                status_code=response.status_code,
                body=response.text[:500],
            )
            raise AIPilotError(f"openai_http_{response.status_code}")

        data = response.json()
        choices = data.get("choices", [])
        if not choices:
            raise AIPilotError("openai_empty_choices")

        content = choices[0].get("message", {}).get("content", "")
        if not content:
            raise AIPilotError("openai_empty_content")

        return content.strip()


class GeminiPilotProvider(BasePilotProvider):
    def __init__(
        self,
        api_key: str,
        model: str = "gemini-1.5-flash",
        base_url: str = "https://generativelanguage.googleapis.com/v1beta/models",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")

    async def chat(
        self,
        messages: list[dict[str, str]],
        system_prompt: str | None = None,
        model: str | None = None,
    ) -> str:
        resolved_model = model or self.model
        effective_system = system_prompt or DEFAULT_SYSTEM_PROMPT

        contents: list[dict[str, Any]] = []
        for msg in messages:
            role = "user" if msg["role"] == "user" else "model"
            contents.append({"role": role, "parts": [{"text": msg["content"]}]})

        payload: dict[str, Any] = {
            "contents": contents,
            "systemInstruction": {"parts": [{"text": effective_system}]},
            "generationConfig": {
                "maxOutputTokens": 1024,
                "temperature": 0.7,
            },
        }

        url = f"{self.base_url}/{resolved_model}:generateContent"

        settings = get_settings()
        timeout = settings.ai_request_timeout_seconds
        headers = {"x-goog-api-key": self.api_key}

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload, headers=headers)

        if response.status_code >= 400:
            logger.warning(
                "ai_pilot_gemini_error",
                status_code=response.status_code,
                body=response.text[:500],
            )
            raise AIPilotError(f"gemini_http_{response.status_code}")

        data = response.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise AIPilotError("gemini_empty_candidates")

        parts = candidates[0].get("content", {}).get("parts", [])
        if not parts:
            raise AIPilotError("gemini_empty_parts")

        content = parts[0].get("text", "")
        if not content:
            raise AIPilotError("gemini_empty_content")

        return content.strip()


class OpenRouterPilotProvider(BasePilotProvider):
    def __init__(
        self,
        api_key: str,
        model: str = "google/gemini-2.0-flash-001",
        base_url: str = "https://openrouter.ai/api/v1",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")

    async def chat(
        self,
        messages: list[dict[str, str]],
        system_prompt: str | None = None,
        model: str | None = None,
    ) -> str:
        resolved_model = model or self.model
        effective_system = system_prompt or DEFAULT_SYSTEM_PROMPT

        api_messages: list[dict[str, str]] = [{"role": "system", "content": effective_system}]
        api_messages.extend(messages)

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": (get_settings().openrouter_app_url or "").strip()
            or "https://madar.hamedco.com",
            "X-Title": get_settings().openrouter_app_title or "MadarBot",
        }
        payload = {
            "model": resolved_model,
            "messages": api_messages,
            "max_tokens": 1024,
            "temperature": 0.7,
        }

        settings = get_settings()
        timeout = settings.ai_request_timeout_seconds

        url = f"{self.base_url}/chat/completions"

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=payload)

        if response.status_code >= 400:
            logger.warning(
                "ai_pilot_openrouter_error",
                status_code=response.status_code,
                body=response.text[:500],
            )
            raise AIPilotError(f"openrouter_http_{response.status_code}")

        data = response.json()
        choices = data.get("choices", [])
        if not choices:
            raise AIPilotError("openrouter_empty_choices")

        content = choices[0].get("message", {}).get("content", "")
        if not content:
            raise AIPilotError("openrouter_empty_content")

        return content.strip()


class HeuristicPilotProvider(BasePilotProvider):
    async def chat(
        self,
        messages: list[dict[str, str]],
        system_prompt: str | None = None,
        model: str | None = None,
    ) -> str:
        return FALLBACK_REPLY


def _normalize_url(url: str | None, default: str) -> str:
    if not url:
        return default
    url = url.strip()
    if not url:
        return default
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    return url


def build_pilot_provider(
    api_key: str | None = None,
    model: str | None = None,
    base_url: str | None = None,
) -> BasePilotProvider:
    settings = get_settings()
    provider_name = settings.ai_provider.strip().lower()

    if provider_name == "openai":
        resolved_key = api_key or settings.openai_api_key
        if not resolved_key:
            logger.warning("ai_pilot_no_openai_key")
            return HeuristicPilotProvider()
        resolved_model = model or settings.ai_model or settings.openai_model
        resolved_url = _normalize_url(base_url, "https://api.openai.com/v1")
        return OpenAIPilotProvider(resolved_key, resolved_model, resolved_url)

    if provider_name == "gemini":
        resolved_key = api_key or settings.gemini_api_key
        if not resolved_key:
            logger.warning("ai_pilot_no_gemini_key")
            return HeuristicPilotProvider()
        resolved_model = model or settings.ai_model or settings.gemini_model
        resolved_url = _normalize_url(base_url, "https://generativelanguage.googleapis.com/v1beta/models")
        return GeminiPilotProvider(resolved_key, resolved_model, resolved_url)

    if provider_name == "openrouter":
        resolved_key = api_key or settings.openrouter_api_key
        if not resolved_key:
            logger.warning("ai_pilot_no_openrouter_key")
            return HeuristicPilotProvider()
        resolved_model = model or settings.ai_model or settings.openrouter_model
        resolved_url = _normalize_url(base_url, "https://openrouter.ai/api/v1")
        return OpenRouterPilotProvider(resolved_key, resolved_model, resolved_url)

    logger.info("ai_pilot_heuristic_fallback", provider=provider_name)
    return HeuristicPilotProvider()
