from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context
from bot.services.subscription_service import SubscriptionService


def _serialize_subscription(sub) -> dict:
    return {
        "id": sub.id,
        "tg_user_id": sub.tg_user_id,
        "username": sub.username,
        "full_name": sub.full_name,
        "status": sub.status,
        "plan": sub.plan,
        "bot_kind": sub.bot_kind,
        "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
        "created_at": sub.created_at.isoformat() if sub.created_at else None,
    }


def register_subscription_tools(server: FastMCP) -> None:

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_get_subscription(tg_user_id: int | None = None) -> dict:
        """Get the active subscription for a user. Defaults to MCP actor if not specified."""
        ctx = resolve_mcp_context()
        target_user_id = tg_user_id or ctx.actor_user_id
        async with SessionLocal() as session:
            service = SubscriptionService(session)
            sub = await service.get_active_subscription(
                tg_user_id=target_user_id,
                bot_kind="agents",
            )
            if sub:
                return {"subscription": _serialize_subscription(sub)}
            return {"subscription": None}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_list_subscriptions() -> dict:
        """List all active subscriptions for the agents miniapp."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = SubscriptionService(session)
            subs = await service.list_active_subscriptions(bot_kind="agents")
            return {
                "subscriptions": [_serialize_subscription(s) for s in subs],
                "total": len(subs),
            }

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False))
    async def madarbot_grant_subscription(
        tg_user_id: int,
        plan: str = "pro",
        expires_at: str | None = None,
    ) -> dict:
        """Grant a subscription. Requires MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}
        from datetime import datetime, timezone
        async with SessionLocal() as session:
            service = SubscriptionService(session)
            expires = None
            if expires_at:
                expires = datetime.fromisoformat(expires_at).replace(tzinfo=timezone.utc)
            sub = await service.set_user_plan(
                tg_user_id=tg_user_id,
                plan=plan,
                expires_at=expires,
                responder_id=ctx.actor_user_id,
                bot_kind="agents",
            )
            return {"subscription": _serialize_subscription(sub)}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False))
    async def madarbot_cancel_subscription(tg_user_id: int, confirm: bool = False) -> dict:
        """Cancel a subscription. Requires confirmation and MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}
        if not confirm:
            return {"error": "Confirmation required. Set confirm=true to proceed."}
        async with SessionLocal() as session:
            service = SubscriptionService(session)
            result = await service.cancel_subscription(
                tg_user_id=tg_user_id,
                responder_id=ctx.actor_user_id,
                bot_kind="agents",
            )
            return {"success": result}
