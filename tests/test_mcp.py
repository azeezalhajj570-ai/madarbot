from __future__ import annotations

import json
import sys
import pytest

from bot.config import get_settings

pytestmark = pytest.mark.skipif(
    sys.version_info < (3, 10),
    reason="mcp package requires Python 3.10+",
)


def _parse_result(result: str) -> dict:
    """Parse a structured MCP response string."""
    if isinstance(result, str):
        return json.loads(result)
    return result


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
        from bot.mcp.tools.health import register_health_tools
        from mcp.server.fastmcp import FastMCP

        server = FastMCP("test")
        register_health_tools(server)

        tool = server._tool_manager.list_tools()
        health_tool = next(t for t in tool if t.name == "madarbot_health")
        result = _parse_result(await health_tool.fn())
        assert result["content"] == "MCP server is healthy"
        assert result["structuredContent"]["data"]["status"] == "ok"
        assert result["structuredContent"]["data"]["readonly"] is True
        assert result["structuredContent"]["data"]["actor_user_id"] == 1001


class TestMcpStructuredResponse:
    """Test that all tools return structured responses."""

    @pytest.mark.asyncio
    async def test_health_has_structured_content(self):
        from bot.mcp.tools.health import register_health_tools
        from mcp.server.fastmcp import FastMCP

        server = FastMCP("test")
        register_health_tools(server)
        tool = next(t for t in server._tool_manager.list_tools() if t.name == "madarbot_health")
        result = _parse_result(await tool.fn())
        assert "content" in result
        assert "structuredContent" in result
        assert "data" in result["structuredContent"]
        assert "metadata" in result["structuredContent"]

    @pytest.mark.asyncio
    async def test_error_response_structure(self):
        from bot.mcp.tools.accounts import madarbot_delete_account

        result = _parse_result(await madarbot_delete_account(agent_id=1))
        assert "content" in result
        assert "structuredContent" in result
        assert "error" in result["structuredContent"]
        assert "code" in result["structuredContent"]["error"]
        assert "message" in result["structuredContent"]["error"]

    @pytest.mark.asyncio
    async def test_success_response_has_metadata(self):
        from bot.mcp.tools.health import register_health_tools
        from mcp.server.fastmcp import FastMCP

        server = FastMCP("test")
        register_health_tools(server)
        tool = next(t for t in server._tool_manager.list_tools() if t.name == "madarbot_health")
        result = _parse_result(await tool.fn())
        metadata = result["structuredContent"]["metadata"]
        assert metadata["source"] == "madarbot-mcp"
        assert metadata["version"] == "1.0"


class TestMcpReadonly:
    @pytest.mark.asyncio
    async def test_delete_account_blocked_in_readonly(self):
        from bot.mcp.tools.accounts import madarbot_delete_account

        result = _parse_result(await madarbot_delete_account(agent_id=1))
        assert "structuredContent" in result
        assert result["structuredContent"]["error"]["code"] == "READONLY_MODE"

    @pytest.mark.asyncio
    async def test_update_account_blocked_in_readonly(self):
        from bot.mcp.tools.accounts import madarbot_update_account

        result = _parse_result(
            await madarbot_update_account(agent_id=1, external_account_id="test")
        )
        assert "structuredContent" in result
        assert result["structuredContent"]["error"]["code"] == "READONLY_MODE"

    @pytest.mark.asyncio
    async def test_delete_task_blocked_in_readonly(self):
        from bot.mcp.tools.tasks import madarbot_delete_task

        result = _parse_result(await madarbot_delete_task(group_id=1, assignment_id="abc"))
        assert "structuredContent" in result
        assert result["structuredContent"]["error"]["code"] == "READONLY_MODE"

    @pytest.mark.asyncio
    async def test_delete_lead_blocked_in_readonly(self):
        from bot.mcp.tools.leads import madarbot_delete_lead

        result = _parse_result(await madarbot_delete_lead(lead_id=1))
        assert "structuredContent" in result
        assert result["structuredContent"]["error"]["code"] == "READONLY_MODE"

    @pytest.mark.asyncio
    async def test_mark_notifications_blocked_in_readonly(self):
        from bot.mcp.tools.notifications import madarbot_mark_notifications_seen

        result = _parse_result(await madarbot_mark_notifications_seen())
        assert "structuredContent" in result
        assert result["structuredContent"]["error"]["code"] == "READONLY_MODE"

    @pytest.mark.asyncio
    async def test_cancel_subscription_blocked_in_readonly(self):
        from bot.mcp.tools.subscriptions import madarbot_cancel_subscription

        result = _parse_result(await madarbot_cancel_subscription(tg_user_id=1))
        assert "structuredContent" in result
        assert result["structuredContent"]["error"]["code"] == "READONLY_MODE"


class TestMcpConfirmation:
    @pytest.mark.asyncio
    async def test_delete_account_requires_confirmation(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("MCP_READONLY", "false")
        get_settings.cache_clear()
        from bot.mcp.tools.accounts import madarbot_delete_account

        result = _parse_result(await madarbot_delete_account(agent_id=1))
        assert "structuredContent" in result
        assert result["structuredContent"]["error"]["code"] == "CONFIRMATION_REQUIRED"

    @pytest.mark.asyncio
    async def test_delete_lead_requires_confirmation(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("MCP_READONLY", "false")
        get_settings.cache_clear()
        from bot.mcp.tools.leads import madarbot_delete_lead

        result = _parse_result(await madarbot_delete_lead(lead_id=1))
        assert "structuredContent" in result
        assert result["structuredContent"]["error"]["code"] == "CONFIRMATION_REQUIRED"

    @pytest.mark.asyncio
    async def test_cancel_subscription_requires_confirmation(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("MCP_READONLY", "false")
        get_settings.cache_clear()
        from bot.mcp.tools.subscriptions import madarbot_cancel_subscription

        result = _parse_result(await madarbot_cancel_subscription(tg_user_id=1))
        assert "structuredContent" in result
        assert result["structuredContent"]["error"]["code"] == "CONFIRMATION_REQUIRED"


class TestMcpSafety:
    @pytest.mark.asyncio
    async def test_safety_mode_cannot_be_disabled(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("MCP_READONLY", "false")
        get_settings.cache_clear()
        from bot.mcp.tools.analytics import madarbot_update_safety_settings

        result = _parse_result(
            await madarbot_update_safety_settings(
                agent_id=1,
                safety_mode_enabled=False,
            )
        )
        assert "structuredContent" in result
        assert result["structuredContent"]["error"]["code"] == "VALIDATION_ERROR"

    @pytest.mark.asyncio
    async def test_reject_high_action_limits(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("MCP_READONLY", "false")
        get_settings.cache_clear()
        from bot.mcp.tools.analytics import madarbot_update_safety_settings

        result = _parse_result(
            await madarbot_update_safety_settings(
                agent_id=1,
                max_actions_per_hour=99999,
            )
        )
        assert "structuredContent" in result
        assert result["structuredContent"]["error"]["code"] == "VALIDATION_ERROR"

    @pytest.mark.asyncio
    async def test_reject_high_message_limits(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("MCP_READONLY", "false")
        get_settings.cache_clear()
        from bot.mcp.tools.analytics import madarbot_update_safety_settings

        result = _parse_result(
            await madarbot_update_safety_settings(
                agent_id=1,
                max_messages_per_day=99999,
            )
        )
        assert "structuredContent" in result
        assert result["structuredContent"]["error"]["code"] == "VALIDATION_ERROR"


class TestMcpScrapeLimits:
    @pytest.mark.asyncio
    async def test_scrape_limit_enforced(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("MCP_READONLY", "false")
        get_settings.cache_clear()
        from bot.mcp.tools.groups import madarbot_start_group_sync

        result = _parse_result(
            await madarbot_start_group_sync(agent_id=1, tg_group_id=-100, limit=100000)
        )
        assert "structuredContent" in result
        assert "error" in result["structuredContent"]


class TestMcpServer:
    def test_create_server_registers_tools(self):
        from bot.mcp.server import create_mcp_server

        server = create_mcp_server()
        tools = server._tool_manager.list_tools()
        tool_names = {t.name for t in tools}

        assert "madarbot_health" in tool_names
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

    def test_tools_have_output_schema_in_router(self):
        """Verify that MCP router declares outputSchema for all tools."""
        from bot.dashboard.api.mcp_router import TOOL_OUTPUT_SCHEMAS
        from bot.mcp.server import create_mcp_server

        server = create_mcp_server()
        tools = server._tool_manager.list_tools()

        for tool in tools:
            assert tool.name in TOOL_OUTPUT_SCHEMAS, (
                f"Tool '{tool.name}' missing from TOOL_OUTPUT_SCHEMAS"
            )
            schema = TOOL_OUTPUT_SCHEMAS[tool.name]
            assert "properties" in schema
            assert "content" in schema["properties"]
