from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.mcp.context import resolve_mcp_context


def register_health_tools(server: FastMCP) -> None:

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_health() -> dict:
        """Check MadarBot MCP server health and configuration."""
        ctx = resolve_mcp_context()
        return {
            "status": "ok",
            "readonly": ctx.readonly,
            "actor_user_id": ctx.actor_user_id,
        }
