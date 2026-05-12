from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.agents.service import AgentService
from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context
from bot.mcp.structured_response import (
    OUTPUT_SCHEMA_BASE,
    error_response,
    success_response,
    to_mcp_text,
)


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


ACCOUNT_OUTPUT_SCHEMA = {
    **OUTPUT_SCHEMA_BASE,
    "properties": {
        **OUTPUT_SCHEMA_BASE["properties"],
        "structuredContent": {
            "type": "object",
            "properties": {
                "data": {
                    "type": "object",
                    "properties": {
                        "accounts": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "integer"},
                                    "telegram_user_id": {"type": "integer"},
                                    "status": {"type": "string"},
                                    "external_account_id": {"type": "string"},
                                },
                            },
                        },
                        "total": {"type": "integer"},
                    },
                },
            },
        },
    },
}


def register_account_tools(server: FastMCP) -> None:

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),

    )
    async def madarbot_list_accounts() -> str:
        """List all linked Telegram accounts for the MCP actor."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentService(session)
            agents = await service.list_all_active_agents(actor_user_id=ctx.actor_user_id)
            accounts = [_serialize_agent(a) for a in agents]
            result = success_response(
                content=f"Found {len(accounts)} linked account{'s' if len(accounts) != 1 else ''}",
                data={"accounts": accounts, "total": len(accounts)},
            )
            return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),

    )
    async def madarbot_get_account(agent_id: int) -> str:
        """Get details of a specific linked account by agent_id."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentService(session)
            agent = await service.get_agent(agent_id=agent_id)
            if agent is None:
                result = error_response(
                    content="Account not found",
                    code="NOT_FOUND",
                    message=f"No account found with agent_id={agent_id}",
                )
                return to_mcp_text(result)
            if int(agent.linked_by_user_id) != ctx.actor_user_id:
                result = error_response(
                    content="Access denied",
                    code="ACCESS_DENIED",
                    message="You do not have permission to view this account",
                )
                return to_mcp_text(result)
            result = success_response(
                content=f"Account @{agent.external_account_id or agent.id}",
                data={"account": _serialize_agent(agent)},
            )
            return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False),

    )
    async def madarbot_update_account(
        agent_id: int,
        external_account_id: str | None = None,
        phone_number: str | None = None,
        metadata: dict | None = None,
    ) -> str:
        """Update a linked account. Requires MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            result = error_response(
                content="Write operations are disabled",
                code="READONLY_MODE",
                message="Set MCP_READONLY=false to enable write operations",
            )
            return to_mcp_text(result)
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
                result = success_response(
                    content="Account updated successfully",
                    data={"account": _serialize_agent(agent)},
                )
                return to_mcp_text(result)
            except ValueError as e:
                result = error_response(
                    content=f"Failed to update account: {e}",
                    code="VALIDATION_ERROR",
                    message=str(e),
                )
                return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False),

    )
    async def madarbot_delete_account(agent_id: int, confirm: bool = False) -> str:
        """Delete a linked account. Requires confirmation and MCP_READONLY=false."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            result = error_response(
                content="Write operations are disabled",
                code="READONLY_MODE",
                message="Set MCP_READONLY=false to enable write operations",
            )
            return to_mcp_text(result)
        if not confirm:
            result = error_response(
                content="Confirmation required",
                code="CONFIRMATION_REQUIRED",
                message="Set confirm=true to proceed with deletion",
            )
            return to_mcp_text(result)
        async with SessionLocal() as session:
            service = AgentService(session)
            try:
                deleted = await service.unlink_agent(actor_user_id=ctx.actor_user_id, agent_id=agent_id)
                if deleted:
                    result = success_response(
                        content="Account deleted successfully",
                        data={"success": True, "agent_id": agent_id},
                    )
                    return to_mcp_text(result)
                result = error_response(
                    content="Account not found or access denied",
                    code="NOT_FOUND",
                    message="No account found with the given agent_id or you don't have permission",
                )
                return to_mcp_text(result)
            except ValueError as e:
                result = error_response(
                    content=f"Failed to delete account: {e}",
                    code="VALIDATION_ERROR",
                    message=str(e),
                )
                return to_mcp_text(result)
