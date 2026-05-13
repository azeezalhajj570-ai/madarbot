from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context
from bot.mcp.structured_response import (
    error_response,
    success_response,
    to_mcp_text,
)
from bot.agents.agent_notification_service import AgentNotificationService


def register_notification_tools(server: FastMCP) -> None:

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_list_notifications(
        agent_id: int | None = None,
        group_id: int | None = None,
        limit: int = 50,
    ) -> str:
        """List notifications for the MCP actor."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentNotificationService(session)
            result_data = await service.list_notifications(
                actor_user_id=ctx.actor_user_id,
                agent_id=agent_id,
                group_id=group_id,
                limit=limit,
            )
            notifications = result_data.get("notifications", [])
            result = success_response(
                content=f"Found {len(notifications)} notification{'s' if len(notifications) != 1 else ''}",
                data=result_data,
            )
            return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_mark_notifications_seen(
        agent_id: int | None = None,
        group_id: int | None = None,
    ) -> str:
        """Mark all notifications as seen. Requires MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            result = error_response(
                content="Write operations are disabled",
                code="READONLY_MODE",
                message="Set MCP_READONLY=false to enable write operations",
            )
            return to_mcp_text(result)
        async with SessionLocal() as session:
            service = AgentNotificationService(session)
            count = await service.mark_all_seen(
                actor_user_id=ctx.actor_user_id,
                agent_id=agent_id,
                group_id=group_id,
            )
            result = success_response(
                content=f"Marked {count} notification{'s' if count != 1 else ''} as seen",
                data={"marked_seen": count},
            )
            return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_get_unseen_count(
        agent_id: int | None = None,
        group_id: int | None = None,
    ) -> str:
        """Get count of unseen notifications."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentNotificationService(session)
            result_data = await service.list_notifications(
                actor_user_id=ctx.actor_user_id,
                agent_id=agent_id,
                group_id=group_id,
                limit=1,
            )
            unseen = result_data.get("unseen_count", 0)
            result = success_response(
                content=f"You have {unseen} unseen notification{'s' if unseen != 1 else ''}",
                data={"unseen_count": unseen},
            )
            return to_mcp_text(result)
