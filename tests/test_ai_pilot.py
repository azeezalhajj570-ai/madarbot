from __future__ import annotations

from types import SimpleNamespace

import importlib
import pytest
from unittest.mock import AsyncMock, patch

from bot.core.event_bus import Event, EventBus
from bot.plugins.ai_pilot.provider import (
    OpenAIPilotProvider,
    GeminiPilotProvider,
    HeuristicPilotProvider,
    build_pilot_provider,
    AIPilotError,
    FALLBACK_REPLY,
)
from bot.plugins.ai_pilot.rate_limiter import AIPilotRateLimiter
from bot.plugins.ai_pilot.service import AIPilotService


class TestAIPilotRateLimiter:
    @pytest.mark.asyncio
    async def test_is_allowed_first_n_calls(self, fake_redis):
        limiter = AIPilotRateLimiter(fake_redis)
        for _ in range(3):
            assert await limiter.is_allowed(123, max_replies=3, window_seconds=60)
            await fake_redis.set("_time_advance", 1)

    @pytest.mark.asyncio
    async def test_is_blocked_after_exceeding_max(self, fake_redis):
        limiter = AIPilotRateLimiter(fake_redis)
        for _ in range(5):
            await limiter.is_allowed(456, max_replies=5, window_seconds=60)
        assert not await limiter.is_allowed(456, max_replies=5, window_seconds=60)

    @pytest.mark.asyncio
    async def test_different_users_have_separate_windows(self, fake_redis):
        limiter = AIPilotRateLimiter(fake_redis)
        for _ in range(2):
            assert await limiter.is_allowed(111, max_replies=2, window_seconds=60)
        assert not await limiter.is_allowed(111, max_replies=2, window_seconds=60)
        assert await limiter.is_allowed(222, max_replies=2, window_seconds=60)


class TestAIPilotProvider:
    @pytest.mark.asyncio
    async def test_heuristic_provider_returns_fallback(self):
        provider = HeuristicPilotProvider()
        reply = await provider.chat([{"role": "user", "content": "hello"}])
        assert reply == FALLBACK_REPLY

    @pytest.mark.asyncio
    async def test_openai_provider_chat_success(self, monkeypatch):
        mock_response = SimpleNamespace(
            status_code=200,
            json=lambda: {"choices": [{"message": {"content": "Hello from OpenAI!"}}]},
        )

        async def mock_post(*_args, **_kwargs):
            return mock_response

        monkeypatch.setattr("httpx.AsyncClient.post", mock_post)
        monkeypatch.setattr("httpx.AsyncClient.__aenter__", AsyncMock())
        monkeypatch.setattr("httpx.AsyncClient.__aexit__", AsyncMock())

        provider = OpenAIPilotProvider(api_key="test-key")
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(
                return_value=SimpleNamespace(post=mock_post)
            )
            mock_client.return_value.__aexit__ = AsyncMock(return_value=None)
            reply = await provider.chat([{"role": "user", "content": "hi"}])
        assert "Hello from OpenAI" in reply

    @pytest.mark.asyncio
    async def test_gemini_provider_chat_success(self, monkeypatch):
        mock_response = SimpleNamespace(
            status_code=200,
            json=lambda: {"candidates": [{"content": {"parts": [{"text": "Hello from Gemini!"}]}}]},
        )

        async def mock_post(*_args, **_kwargs):
            return mock_response

        provider = GeminiPilotProvider(api_key="test-key")
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(
                return_value=SimpleNamespace(post=mock_post)
            )
            mock_client.return_value.__aexit__ = AsyncMock(return_value=None)
            reply = await provider.chat([{"role": "user", "content": "hi"}])
        assert "Hello from Gemini" in reply

    @pytest.mark.asyncio
    async def test_openai_provider_raises_on_http_error(self, monkeypatch):
        mock_response = SimpleNamespace(
            status_code=500,
            text='{"error": "server error"}',
            json=lambda: {"error": "server error"},
        )

        async def mock_post(*_args, **_kwargs):
            return mock_response

        provider = OpenAIPilotProvider(api_key="test-key")
        with patch("httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__ = AsyncMock(
                return_value=SimpleNamespace(post=mock_post)
            )
            mock_client.return_value.__aexit__ = AsyncMock(return_value=None)
            with pytest.raises(AIPilotError, match="openai_http_500"):
                await provider.chat([{"role": "user", "content": "hi"}])

    @pytest.mark.asyncio
    async def test_build_pilot_provider_heuristic_default(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "heuristic")
        from bot.config import get_settings

        get_settings.cache_clear()
        provider = build_pilot_provider()
        assert isinstance(provider, HeuristicPilotProvider)

    @pytest.mark.asyncio
    async def test_build_pilot_provider_openai(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "openai")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        from bot.config import get_settings

        get_settings.cache_clear()
        provider = build_pilot_provider()
        assert isinstance(provider, OpenAIPilotProvider)

    @pytest.mark.asyncio
    async def test_build_pilot_provider_fallback_when_no_key(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "openai")
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        from bot.config import get_settings

        get_settings.cache_clear()
        provider = build_pilot_provider()
        assert isinstance(provider, HeuristicPilotProvider)

    @pytest.mark.asyncio
    async def test_build_pilot_provider_with_custom_overrides(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "openai")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-global")
        from bot.config import get_settings

        get_settings.cache_clear()
        provider = build_pilot_provider(
            api_key="sk-custom",
            model="gpt-4o",
            base_url="https://custom.api.example.com/v1",
        )
        assert isinstance(provider, OpenAIPilotProvider)
        assert provider.api_key == "sk-custom"
        assert provider.model == "gpt-4o"
        assert provider.base_url == "https://custom.api.example.com/v1"

    @pytest.mark.asyncio
    async def test_build_pilot_provider_uses_global_when_no_overrides(self, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "openai")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-global")
        monkeypatch.setenv("OPENAI_MODEL", "gpt-4-turbo")
        from bot.config import get_settings

        get_settings.cache_clear()
        provider = build_pilot_provider()
        assert isinstance(provider, OpenAIPilotProvider)
        assert provider.api_key == "sk-global"
        assert provider.base_url == "https://api.openai.com/v1"


class TestAIPilotService:
    @pytest.mark.asyncio
    async def test_generate_reply_uses_history(self, fake_redis, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "openai")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        from bot.config import get_settings

        get_settings.cache_clear()

        from bot.plugins.ai_pilot.provider import OpenAIPilotProvider

        class FakeProvider(OpenAIPilotProvider):
            def __init__(self):
                pass

            async def chat(self, messages, system_prompt=None, model=None):
                assert len(messages) >= 1
                assert messages[-1]["role"] == "user"
                assert messages[-1]["content"] == "what is my name?"
                return "Your name is Alice."

        provider = FakeProvider()
        service = AIPilotService(
            redis=fake_redis,
            provider=provider,
            max_history=5,
        )

        await service._append_history(42, "user", "my name is Alice")
        await service._append_history(42, "assistant", "Nice to meet you Alice!")

        reply = await service.generate_reply(42, "what is my name?")
        assert reply == "Your name is Alice."

    @pytest.mark.asyncio
    async def test_generate_reply_rate_limited(self, fake_redis, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "heuristic")
        from bot.config import get_settings

        get_settings.cache_clear()

        provider = HeuristicPilotProvider()
        service = AIPilotService(
            redis=fake_redis,
            provider=provider,
            rate_limit_max=2,
            rate_limit_window_s=60,
        )

        await service.generate_reply(99, "msg1")
        await service.generate_reply(99, "msg2")
        reply = await service.generate_reply(99, "msg3")
        assert reply is None

    @pytest.mark.asyncio
    async def test_generate_reply_appends_to_history(self, fake_redis, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "heuristic")
        from bot.config import get_settings

        get_settings.cache_clear()

        provider = HeuristicPilotProvider()
        service = AIPilotService(redis=fake_redis, provider=provider, max_history=5)

        await service.generate_reply(77, "hello bot")
        history = await service.get_conversation_history(77)
        assert len(history) == 2
        assert history[0]["role"] == "user"
        assert history[0]["content"] == "hello bot"
        assert history[1]["role"] == "assistant"
        assert history[1]["content"] == FALLBACK_REPLY

    @pytest.mark.asyncio
    async def test_generate_reply_passes_model_to_provider(self, fake_redis, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "heuristic")
        from bot.config import get_settings

        get_settings.cache_clear()

        called_model = None

        class TrackingProvider(HeuristicPilotProvider):
            async def chat(self, messages, system_prompt=None, model=None):
                nonlocal called_model
                called_model = model
                return FALLBACK_REPLY

        provider = TrackingProvider()
        service = AIPilotService(
            redis=fake_redis,
            provider=provider,
            max_history=5,
            model="custom-model-v2",
        )

        await service.generate_reply(88, "test")
        assert called_model == "custom-model-v2"


class TestAIPilotPlugin:
    @pytest.mark.asyncio
    async def test_plugin_ignores_group_messages(self, fake_bot, fake_redis, monkeypatch):
        monkeypatch.setenv("AI_PILOT_ENABLED", "true")
        from bot.config import get_settings

        get_settings.cache_clear()

        ai_pilot_module = importlib.import_module("bot.plugins.ai_pilot.plugin")
        plugin = ai_pilot_module.plugin

        bus = EventBus()
        await plugin.setup(None, bus)

        await bus.publish(
            Event(
                name="MessageReceived",
                group_id=-10012345,
                user_id=4444,
                payload={
                    "text": "hello group",
                    "message_id": 1,
                    "chat_id": -10012345,
                    "bot": fake_bot,
                    "redis": fake_redis,
                },
            )
        )

        assert fake_bot.sent_messages == []
        await plugin.teardown(None, bus)

    @pytest.mark.asyncio
    async def test_plugin_ignores_when_global_disabled(self, fake_bot, fake_redis, monkeypatch):
        monkeypatch.setenv("AI_PILOT_ENABLED", "false")
        from bot.config import get_settings

        get_settings.cache_clear()

        ai_pilot_module = importlib.import_module("bot.plugins.ai_pilot.plugin")
        plugin = ai_pilot_module.plugin

        bus = EventBus()
        await plugin.setup(None, bus)

        await bus.publish(
            Event(
                name="MessageReceived",
                group_id=None,
                user_id=4444,
                payload={
                    "text": "hello dm",
                    "message_id": 2,
                    "chat_id": 4444,
                    "bot": fake_bot,
                    "redis": fake_redis,
                },
            )
        )

        assert fake_bot.sent_messages == []
        await plugin.teardown(None, bus)

    @pytest.mark.asyncio
    async def test_plugin_spoof_private_message_generates_reply(
        self, fake_bot, fake_redis, monkeypatch
    ):
        monkeypatch.setenv("AI_PILOT_ENABLED", "true")
        monkeypatch.setenv("AI_PROVIDER", "heuristic")
        from bot.config import get_settings

        get_settings.cache_clear()

        ai_pilot_module = importlib.import_module("bot.plugins.ai_pilot.plugin")
        plugin = ai_pilot_module.plugin

        async def _mock_check(_bot):
            return True

        async def _mock_load(_bot):
            return {
                "system_prompt": "",
                "max_history": 10,
                "rate_limit_max": 5,
                "rate_limit_window_s": 60,
                "model": "",
                "provider_url": "",
                "api_key": "",
            }

        monkeypatch.setattr(plugin, "_check_plugin_enabled_for_bot", _mock_check)
        monkeypatch.setattr(plugin, "_load_per_group_settings", _mock_load)

        bot_token = get_settings().resolve_bot_token("admin")
        fake_bot.token = bot_token

        bus = EventBus()
        await plugin.setup(None, bus)

        await bus.publish(
            Event(
                name="MessageReceived",
                group_id=None,
                user_id=5555,
                payload={
                    "text": "hi there",
                    "message_id": 3,
                    "chat_id": 5555,
                    "bot": fake_bot,
                    "redis": fake_redis,
                },
            )
        )

        assert len(fake_bot.sent_messages) == 1
        assert fake_bot.sent_messages[0][0] == 5555
        assert len(fake_bot.sent_messages[0][1]) > 0

        await plugin.teardown(None, bus)
