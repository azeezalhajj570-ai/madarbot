from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.agents.service import AgentService
from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context


def _serialize_agent(agent) -> dict:
    return {
        "id": agent.id,
        "telegram_user_id": agent.telegram_user_id,
        "linked_by_user_id": agent.linked_by_user_id,
        "group_id": agent.group_id,
        "phone_number": agent.phone_number,
        "external_account_id": agent.external_account_id,
        "status": agent.status,
        "auth_state": agent.auth_state,
        "max_actions_per_hour": agent.max_actions_per_hour,
        "max_messages_per_day": agent.max_messages_per_day,
        "min_delay_seconds": agent.min_delay_seconds,
        "cooldown_minutes": agent.cooldown_minutes,
        "safety_mode_enabled": agent.safety_mode_enabled,
        "created_at": agent.created_at.isoformat() if agent.created_at else None,
        "updated_at": agent.updated_at.isoformat() if agent.updated_at else None,
    }


def register_account_tools(server: FastMCP) -> None:

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_list_accounts() -> dict:
        """List all linked Telegram accounts for the MCP actor."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentService(session)
            agents = await service.list_all_active_agents(actor_user_id=ctx.actor_user_id)
            return {
                "accounts": [_serialize_agent(a) for a in agents],
                "total": len(agents),
            }

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_get_account(agent_id: int) -> dict:
        """Get details of a specific linked account by agent_id."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentService(session)
            agent = await service.get_agent(agent_id=agent_id)
            if agent is None:
                return {"error": "Account not found"}
            if int(agent.linked_by_user_id) != ctx.actor_user_id:
                return {"error": "Access denied"}
            return {"account": _serialize_agent(agent)}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    async def madarbot_update_account(
        agent_id: int,
        external_account_id: str | None = None,
        phone_number: str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        """Update a linked account. Requires MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}
        async with SessionLocal() as session:
            service = AgentService(session)
            try:
                agent = await service.update_agent(
                    actor_user_id=ctx.actor_user_id,
                    agent_id=agent_id,
                    external_account_id=external_account_id or str(agent_id),
                    phone_number=phone_number,
                    metadata=metadata,
                )
                return {"account": _serialize_agent(agent)}
            except ValueError as e:
                return {"error": str(e)}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False))
    async def madarbot_delete_account(agent_id: int, confirm: bool = False) -> dict:
        """Delete a linked account. Requires confirmation and MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}
        if not confirm:
            return {"error": "Confirmation required. Set confirm=true to proceed."}
        async with SessionLocal() as session:
            service = AgentService(session)
            try:
                result = await service.unlink_agent(actor_user_id=ctx.actor_user_id, agent_id=agent_id)
                if result:
                    return {"success": True, "message": "Account deleted"}
                return {"error": "Account not found or access denied"}
            except ValueError as e:
                return {"error": str(e)}
