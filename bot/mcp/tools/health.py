from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.mcp.context import resolve_mcp_context
from bot.mcp.structured_response import (
    OUTPUT_SCHEMA_BASE,
    success_response,
    to_mcp_text,
)

# Output schema for health tool (used by mcp_router for tools/list)
OUTPUT_SCHEMA = OUTPUT_SCHEMA_BASE


def register_health_tools(server: FastMCP) -> None:

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_health() -> str:
        """Check MadarBot MCP server health and configuration."""
        ctx = resolve_mcp_context()
        result = success_response(
            content="MCP server is healthy",
            data={
                "status": "ok",
                "readonly": ctx.readonly,
                "actor_user_id": ctx.actor_user_id,
            },
        )
        return to_mcp_text(result)
