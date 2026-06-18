"""Redis-based per-user rate limiter for AI Pilot."""

from __future__ import annotations

import time

from redis.asyncio import Redis
import structlog

logger = structlog.get_logger(__name__)


class AIPilotRateLimiter:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def is_allowed(
        self,
        user_id: int,
        max_replies: int = 5,
        window_seconds: int = 60,
    ) -> bool:
        key = f"ai_pilot:rl:{user_id}"
        now = time.time()
        cutoff = now - window_seconds

        pipe = self._redis.pipeline()
        pipe.zremrangebyscore(key, "-inf", cutoff)
        pipe.zcard(key)
        results = await pipe.execute()

        count: int = results[1]
        if count >= max_replies:
            logger.info(
                "ai_pilot_rate_limited",
                user_id=user_id,
                count=count,
                max_replies=max_replies,
            )
            return False

        await self._redis.zadd(key, {str(now): now})
        await self._redis.expire(key, window_seconds + 10)
        return True
