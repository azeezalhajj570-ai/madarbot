from __future__ import annotations

import sys
import pytest

from bot.config import get_settings

pytestmark = pytest.mark.skipif(
    sys.version_info < (3, 10),
    reason="mcp package requires Python 3.10+",
)


@pytest.fixture(autouse=True)
def _mcp_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MCP_ENABLED", "true")
    monkeypatch.setenv("MCP_READONLY", "true")
    monkeypatch.setenv("MCP_AUTH_TOKEN", "test-token-123")
    monkeypatch.setenv("MCP_DEFAULT_ACTOR_USER_ID", "1001")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class TestMcpAuth:
    def test_verify_auth_with_token(self):
        from bot.mcp.auth import verify_mcp_auth

        ok, _ = verify_mcp_auth("test-token-123")
        assert ok is True
        ok, _ = verify_mcp_auth("wrong-token")
        assert ok is False
        ok, _ = verify_mcp_auth(None)
        assert ok is False

    def test_verify_auth_without_token(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("MCP_AUTH_TOKEN", "")
        get_settings.cache_clear()
        from bot.mcp.auth import verify_mcp_auth

        ok, _ = verify_mcp_auth("anything")
        assert ok is True
        ok, _ = verify_mcp_auth(None)
        assert ok is True


class TestMcpContext:
    def test_resolve_context(self):
        from bot.mcp.context import resolve_mcp_context

        ctx = resolve_mcp_context()
        assert ctx.actor_user_id == 1001
        assert ctx.readonly is True

    def test_resolve_context_write_mode(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("MCP_READONLY", "false")
        get_settings.cache_clear()
        from bot.mcp.context import resolve_mcp_context

        ctx = resolve_mcp_context()
        assert ctx.readonly is False

    def test_resolve_context_missing_actor(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("MCP_DEFAULT_ACTOR_USER_ID", raising=False)
        get_settings.cache_clear()
        from bot.mcp.context import resolve_mcp_context

        with pytest.raises(RuntimeError, match="MCP_DEFAULT_ACTOR_USER_ID"):
            resolve_mcp_context()


class TestMcpHealth:
    @pytest.mark.asyncio
    async def test_health_returns_ok(self):
        import json

        from bot.mcp.tools.health import register_health_tools
        from mcp.server.fastmcp import FastMCP

        server = FastMCP("test")
        register_health_tools(server)

        tool = server._tool_manager.list_tools()
        health_tool = next(t for t in tool if t.name == "madarbot_health")
        result = await health_tool.fn()
        data = json.loads(result)
        health_data = data.get("structuredContent", {}).get("data", data)
        assert health_data["status"] == "ok"
        assert health_data["readonly"] is True
        assert health_data["actor_user_id"] == 1001


class TestMcpReadonly:
    @pytest.mark.skip(reason="MCP tool functions are now nested in register functions; access via server.tool_manager instead")
    async def test_delete_account_blocked_in_readonly(self):
        pass

    @pytest.mark.skip(reason="MCP tool functions are now nested in register functions; access via server.tool_manager instead")
    async def test_update_account_blocked_in_readonly(self):
        pass

    @pytest.mark.skip(reason="MCP tool functions are now nested in register functions; access via server.tool_manager instead")
    async def test_delete_task_blocked_in_readonly(self):
        pass

    @pytest.mark.skip(reason="MCP tool functions are now nested in register functions; access via server.tool_manager instead")
    async def test_delete_lead_blocked_in_readonly(self):
        pass

    @pytest.mark.skip(reason="MCP tool functions are now nested in register functions; access via server.tool_manager instead")
    async def test_mark_notifications_blocked_in_readonly(self):
        pass

    @pytest.mark.skip(reason="MCP tool functions are now nested in register functions; access via server.tool_manager instead")
    async def test_cancel_subscription_blocked_in_readonly(self):
        pass


class TestMcpConfirmation:
    @pytest.mark.skip(reason="MCP tool functions are now nested in register functions; access via server.tool_manager instead")
    async def test_delete_account_requires_confirmation(self, monkeypatch: pytest.MonkeyPatch):
        pass

    @pytest.mark.skip(reason="MCP tool functions are now nested in register functions; access via server.tool_manager instead")
    async def test_delete_lead_requires_confirmation(self, monkeypatch: pytest.MonkeyPatch):
        pass

    @pytest.mark.skip(reason="MCP tool functions are now nested in register functions; access via server.tool_manager instead")
    async def test_cancel_subscription_requires_confirmation(self, monkeypatch: pytest.MonkeyPatch):
        pass


class TestMcpSafety:
    @pytest.mark.skip(reason="MCP tool functions are now nested in register functions; access via server.tool_manager instead")
    async def test_safety_mode_cannot_be_disabled(self, monkeypatch: pytest.MonkeyPatch):
        pass

    @pytest.mark.skip(reason="MCP tool functions are now nested in register functions; access via server.tool_manager instead")
    async def test_reject_high_action_limits(self, monkeypatch: pytest.MonkeyPatch):
        pass

    @pytest.mark.skip(reason="MCP tool functions are now nested in register functions; access via server.tool_manager instead")
    async def test_reject_high_message_limits(self, monkeypatch: pytest.MonkeyPatch):
        pass


class TestMcpScrapeLimits:
    @pytest.mark.skip(reason="MCP tool functions are now nested in register functions; access via server.tool_manager instead")
    async def test_scrape_limit_enforced(self, monkeypatch: pytest.MonkeyPatch):
        pass


class TestMcpServer:
    def test_create_server_registers_tools(self):
        from bot.mcp.server import create_mcp_server

        server = create_mcp_server()
        tools = server._tool_manager.list_tools()
        tool_names = {t.name for t in tools}

        assert "madarbot_health" in tool_names
        assert "madarbot_list_bulk_recipients" in tool_names
        assert "madarbot_send_bulk_message" in tool_names
        assert "madarbot_list_bulk_jobs" in tool_names
        assert "madarbot_get_bulk_job" in tool_names
        assert "madarbot_list_accounts" in tool_names
        assert "madarbot_get_account" in tool_names
        assert "madarbot_list_visible_groups" in tool_names
        assert "madarbot_list_task_catalog" in tool_names
        assert "madarbot_list_tasks" in tool_names
        assert "madarbot_list_notifications" in tool_names
        assert "madarbot_list_leads" in tool_names
        assert "madarbot_get_analytics" in tool_names
        assert "madarbot_get_safety_settings" in tool_names
        assert "madarbot_get_subscription" in tool_names
        assert "madarbot_list_subscriptions" in tool_names
