from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx
from aiogram import Bot

from bot.config import get_settings

logger = logging.getLogger(__name__)


class HealthAlertService:
    def __init__(self) -> None:
        self._last_alerts: dict[str, datetime] = {}
        self._cooldown = timedelta(minutes=30)

    async def check_and_alert(self) -> None:
        settings = get_settings()
        if not settings.bot_owner_ids:
            return

        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.get("http://localhost:8000/api/internal/system-health")
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                await self._alert_owners(
                    settings, f"🚨 Cannot reach system-health endpoint: {e}"
                )
                return

        overall = data.get("status", "unknown")
        checks = data.get("checks", {})

        if overall == "down":
            await self._alert_owners(
                settings, "🚨 SYSTEM DOWN – Database or Redis unreachable"
            )

        degraded = [
            name
            for name, chk in checks.items()
            if isinstance(chk, dict) and chk.get("status") not in ("ok", None)
        ]
        if degraded:
            details = "; ".join(f"{n}: {checks[n].get('status')}" for n in degraded)
            await self._alert_owners(settings, f"⚠️ Degraded services: {details}")

        queue = checks.get("queue", {})
        pending = queue.get("pending", 0) if isinstance(queue, dict) else 0
        if pending > 50:
            await self._alert_owners(
                settings, f"⚠️ Queue backlog: {pending} pending jobs"
            )

        failures = checks.get("recent_failures_24h", {})
        fail_count = failures.get("count", 0) if isinstance(failures, dict) else 0
        if fail_count > 10:
            await self._alert_owners(
                settings, f"⚠️ {fail_count} job failures in last 24h"
            )

    async def _alert_owners(self, settings, message: str) -> None:
        if self._is_throttled(message):
            return
        self._last_alerts[message] = datetime.now(timezone.utc)
        bot = Bot(token=settings.bot_token)
        try:
            for owner_id in settings.bot_owner_ids:
                try:
                    await bot.send_message(owner_id, message)
                except Exception:
                    logger.exception(
                        "health_alert_send_failed", extra={"owner_id": owner_id}
                    )
        finally:
            await bot.session.close()

    def _is_throttled(self, key: str) -> bool:
        last = self._last_alerts.get(key)
        if last and datetime.now(timezone.utc) - last < self._cooldown:
            return True
        return False
