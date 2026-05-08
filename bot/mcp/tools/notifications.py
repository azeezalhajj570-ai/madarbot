from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context
from bot.agents.agent_notification_service import AgentNotificationService


def register_notification_tools(server: FastMCP) -> None:

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_list_notifications(
        agent_id: int | None = None,
        group_id: int | None = None,
        limit: int = 50,
    ) -> dict:
        """List notifications for the MCP actor."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentNotificationService(session)
            result = await service.list_notifications(
                actor_user_id=ctx.actor_user_id,
                agent_id=agent_id,
                group_id=group_id,
                limit=limit,
            )
            return result

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    async def madarbot_mark_notifications_seen(
        agent_id: int | None = None,
        group_id: int | None = None,
    ) -> dict:
        """Mark all notifications as seen. Requires MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}
        async with SessionLocal() as session:
            service = AgentNotificationService(session)
            count = await service.mark_all_seen(
                actor_user_id=ctx.actor_user_id,
                agent_id=agent_id,
                group_id=group_id,
            )
            return {"marked_seen": count}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_get_unseen_count(
        agent_id: int | None = None,
        group_id: int | None = None,
    ) -> dict:
        """Get count of unseen notifications."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentNotificationService(session)
            result = await service.list_notifications(
                actor_user_id=ctx.actor_user_id,
                agent_id=agent_id,
                group_id=group_id,
                limit=1,
            )
            return {"unseen_count": result.get("unseen_count", 0)}
