from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from bot.mcp.tools.accounts import register_account_tools
from bot.mcp.tools.bulk_messaging import register_bulk_messaging_tools
from bot.mcp.tools.analytics import register_analytics_tools
from bot.mcp.tools.groups import register_group_tools
from bot.mcp.tools.health import register_health_tools
from bot.mcp.tools.leads import register_lead_tools
from bot.mcp.tools.notifications import register_notification_tools
from bot.mcp.tools.subscriptions import register_subscription_tools
from bot.mcp.tools.tasks import register_task_tools


def create_mcp_server() -> FastMCP:
    server = FastMCP("madarbot")
    register_health_tools(server)
    register_account_tools(server)
    register_bulk_messaging_tools(server)
    register_group_tools(server)
    register_task_tools(server)
    register_notification_tools(server)
    register_lead_tools(server)
    register_analytics_tools(server)
    register_subscription_tools(server)
    return server


def create_mcp_asgi_app():
    """Create an ASGI-mountable MCP server for HTTP/SSE transport.

    Returns a Starlette app that can be mounted on FastAPI at /mcp.
    """
    server = create_mcp_server()
    return server.streamable_http_app()
