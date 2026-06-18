"""AI Pilot service — conversation history, prompt building, reply generation."""

from __future__ import annotations

import json
import time

from redis.asyncio import Redis
import structlog

from bot.plugins.ai_pilot.provider import (
    BasePilotProvider,
    HeuristicPilotProvider,
    build_pilot_provider,
)
from bot.plugins.ai_pilot.rate_limiter import AIPilotRateLimiter

logger = structlog.get_logger(__name__)

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful, concise, and truthful AI assistant. "
    "Answer the user's questions directly and accurately. "
    "If you don't know something, say so honestly. "
    "Keep responses friendly but professional. "
    "Do not make up information or provide medical, legal, or financial advice."
)

HISTORY_TTL = 3600
MAX_HISTORY_MESSAGES = 20


class AIPilotService:
    def __init__(
        self,
        redis: Redis,
        provider: BasePilotProvider | None = None,
        system_prompt: str | None = None,
        max_history: int = 10,
        rate_limit_max: int = 5,
        rate_limit_window_s: int = 60,
        model: str | None = None,
    ) -> None:
        self._redis = redis
        self._provider = provider or build_pilot_provider()
        self._system_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
        self._max_history = max(1, min(max_history, MAX_HISTORY_MESSAGES))
        self._rate_limiter = AIPilotRateLimiter(redis)
        self._rate_limit_max = rate_limit_max
        self._rate_limit_window_s = rate_limit_window_s
        self._model = model

    async def get_conversation_history(self, user_id: int) -> list[dict[str, str]]:
        key = f"ai_pilot:history:{user_id}"
        raw = await self._redis.get(key)
        if not raw:
            return []

        try:
            data = json.loads(raw)
            if isinstance(data, list):
                return data
        except (json.JSONDecodeError, TypeError):
            pass

        return []

    async def _append_history(self, user_id: int, role: str, content: str) -> None:
        key = f"ai_pilot:history:{user_id}"
        history = await self.get_conversation_history(user_id)
        history.append({"role": role, "content": content})
        max_items = self._max_history * 2
        if len(history) > max_items:
            history = history[-max_items:]
        await self._redis.set(key, json.dumps(history, ensure_ascii=False), ex=HISTORY_TTL)

    async def generate_reply(self, user_id: int, text: str) -> str | None:
        start = time.monotonic()

        if not await self._rate_limiter.is_allowed(
            user_id,
            max_replies=self._rate_limit_max,
            window_seconds=self._rate_limit_window_s,
        ):
            return None

        history = await self.get_conversation_history(user_id)

        messages: list[dict[str, str]] = list(history)
        messages.append({"role": "user", "content": text})

        try:
            reply = await self._provider.chat(
                messages=messages,
                system_prompt=self._system_prompt,
                model=self._model,
            )
        except Exception as exc:
            latency_ms = int((time.monotonic() - start) * 1000)
            logger.warning(
                "ai_pilot_reply_failed",
                user_id=user_id,
                error=str(exc),
                latency_ms=latency_ms,
            )
            if isinstance(self._provider, HeuristicPilotProvider):
                pass
            else:
                fallback = HeuristicPilotProvider()
                try:
                    reply = await fallback.chat(messages=messages)
                except Exception:
                    return None

        latency_ms = int((time.monotonic() - start) * 1000)

        await self._append_history(user_id, "user", text)
        await self._append_history(user_id, "assistant", reply)

        logger.info(
            "ai_pilot_reply_generated",
            user_id=user_id,
            provider=type(self._provider).__name__,
            latency_ms=latency_ms,
            reply_length=len(reply),
        )

        return reply
