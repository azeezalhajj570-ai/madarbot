"""AI Pilot — Intelligent auto-reply plugin for agent DM conversations."""

from __future__ import annotations

from aiogram import Bot, Dispatcher
from sqlalchemy import select
import structlog

from bot.config import get_settings
from bot.core.event_bus import Event, EventBus
from bot.db.models import Group, PluginEnabled
from bot.db.session import SessionLocal
from bot.schemas.settings import PluginManifest
from bot.services.settings_service import SettingsService
from bot.plugins.ai_pilot.provider import build_pilot_provider
from bot.plugins.ai_pilot.service import AIPilotService

from .schema import SETTINGS_SCHEMA

logger = structlog.get_logger(__name__)


class AIPilotPlugin:
    manifest = PluginManifest(
        name="ai_pilot",
        version="1.0.0",
        description="Automatically replies to DM messages using AI with conversation history as context.",
        categories=["automation"],
    )
    settings_schema = SETTINGS_SCHEMA

    async def setup(self, dispatcher: Dispatcher, event_bus: EventBus) -> None:
        event_bus.subscribe("MessageReceived", self.on_message_received)

    async def teardown(self, dispatcher: Dispatcher, event_bus: EventBus) -> None:
        event_bus.unsubscribe("MessageReceived", self.on_message_received)

    async def on_message_received(self, event: Event) -> None:
        if event.group_id is not None:
            return

        settings = get_settings()
        if not settings.ai_pilot_enabled:
            return

        text = str(event.payload.get("text") or "").strip()
        bot = event.payload.get("bot")
        message_id = event.payload.get("message_id")
        user_id = event.user_id
        redis = event.payload.get("redis")

        if not text or bot is None or message_id is None or user_id is None:
            return
        if redis is None:
            return

        group_enabled = await self._check_plugin_enabled_for_bot(bot)
        if not group_enabled:
            return

        per_group_settings = await self._load_per_group_settings(bot)
        system_prompt = per_group_settings.get("system_prompt") or ""
        max_history = per_group_settings.get("max_history", 10)
        rate_limit_max = per_group_settings.get("rate_limit_max", 5)
        rate_limit_window_s = per_group_settings.get("rate_limit_window_s", 60)
        model = per_group_settings.get("model") or None
        provider_url = per_group_settings.get("provider_url") or None
        api_key = per_group_settings.get("api_key") or None

        provider = build_pilot_provider(
            api_key=api_key,
            model=model,
            base_url=provider_url,
        )
        service = AIPilotService(
            redis=redis,
            provider=provider,
            system_prompt=system_prompt if system_prompt else None,
            max_history=max_history,
            rate_limit_max=rate_limit_max,
            rate_limit_window_s=rate_limit_window_s,
            model=model,
        )

        reply = await service.generate_reply(user_id, text)
        if reply is None:
            return

        try:
            await bot.send_message(
                chat_id=event.payload["chat_id"],
                text=reply,
            )
        except Exception as exc:
            logger.warning(
                "ai_pilot_send_failed",
                user_id=user_id,
                chat_id=event.payload.get("chat_id"),
                error=str(exc),
            )

    async def _check_plugin_enabled_for_bot(self, bot: Bot) -> bool:
        async with SessionLocal() as session:
            group = await self._resolve_group_for_bot(session, bot)
            if group is None:
                return False
            enabled = (
                await session.execute(
                    select(PluginEnabled.enabled).where(
                        PluginEnabled.group_id == group.id,
                        PluginEnabled.plugin_name == self.manifest.name,
                    )
                )
            ).scalar_one_or_none()
            return bool(enabled) if enabled is not None else False

    async def _load_per_group_settings(self, bot: Bot) -> dict:
        result = {
            "system_prompt": "",
            "max_history": 10,
            "rate_limit_max": 5,
            "rate_limit_window_s": 60,
            "model": "",
            "provider_url": "",
            "api_key": "",
        }
        async with SessionLocal() as session:
            group = await self._resolve_group_for_bot(session, bot)
            if group is None:
                return result
            settings_service = SettingsService(session)

            system_prompt = await settings_service.get_one(group.id, "ai_pilot_system_prompt")
            if system_prompt:
                result["system_prompt"] = str(system_prompt)

            max_history = await settings_service.get_one(group.id, "ai_pilot_max_history")
            if max_history is not None:
                try:
                    result["max_history"] = int(max_history)
                except (ValueError, TypeError):
                    pass

            rate_max = await settings_service.get_one(group.id, "ai_pilot_rate_limit_max")
            if rate_max is not None:
                try:
                    result["rate_limit_max"] = int(rate_max)
                except (ValueError, TypeError):
                    pass

            rate_window = await settings_service.get_one(group.id, "ai_pilot_rate_limit_window_s")
            if rate_window is not None:
                try:
                    result["rate_limit_window_s"] = int(rate_window)
                except (ValueError, TypeError):
                    pass

            model = await settings_service.get_one(group.id, "ai_pilot_model")
            if model:
                result["model"] = str(model)

            provider_url = await settings_service.get_one(group.id, "ai_pilot_provider_url")
            if provider_url:
                result["provider_url"] = str(provider_url)

            api_key = await settings_service.get_one(group.id, "ai_pilot_api_key")
            if api_key:
                result["api_key"] = str(api_key)

        return result

    async def _resolve_group_for_bot(self, session, bot: Bot) -> Group | None:
        settings = get_settings()
        all_tokens = settings.all_bot_tokens()
        if bot.token not in all_tokens:
            return None
        from bot.db.models import Agent

        agent_result = await session.execute(select(Agent).where(Agent.status == "active"))
        agents = agent_result.scalars().all()
        if not agents:
            return None

        agent_group_ids = {a.group_id for a in agents if a.group_id is not None}
        if not agent_group_ids:
            return None

        groups_result = await session.execute(select(Group).where(Group.id.in_(agent_group_ids)))
        groups = groups_result.scalars().all()
        if groups:
            return groups[0]

        return None


plugin = AIPilotPlugin()
