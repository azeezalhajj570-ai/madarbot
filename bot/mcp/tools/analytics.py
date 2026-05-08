from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.agents.service import AgentService
from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context

_MAX_ACTIONS_PER_HOUR = 500
_MAX_MESSAGES_PER_DAY = 5000
_MIN_DELAY_SECONDS = 1.0
_MIN_COOLDOWN_MINUTES = 5


def register_analytics_tools(server: FastMCP) -> None:

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_get_analytics(agent_id: int | None = None) -> dict:
        """Get analytics summary for the MCP actor."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentService(session)
            agents = await service.list_all_active_agents(actor_user_id=ctx.actor_user_id)
            if agent_id:
                agents = [a for a in agents if a.id == agent_id]
            return {
                "total_agents": len(agents),
                "active_agents": len([a for a in agents if a.auth_state == "active"]),
                "agents": [
                    {
                        "id": a.id,
                        "auth_state": a.auth_state,
                        "safety_mode_enabled": a.safety_mode_enabled,
                        "max_actions_per_hour": a.max_actions_per_hour,
                        "max_messages_per_day": a.max_messages_per_day,
                    }
                    for a in agents
                ],
            }

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_get_safety_settings(agent_id: int) -> dict:
        """Get safety settings for a specific agent."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentService(session)
            agent = await service.get_agent(agent_id=agent_id)
            if agent is None:
                return {"error": "Agent not found"}
            if int(agent.linked_by_user_id) != ctx.actor_user_id:
                return {"error": "Access denied"}
            return {
                "agent_id": agent.id,
                "safety_mode_enabled": agent.safety_mode_enabled,
                "max_actions_per_hour": agent.max_actions_per_hour,
                "max_messages_per_day": agent.max_messages_per_day,
                "min_delay_seconds": agent.min_delay_seconds,
                "cooldown_minutes": agent.cooldown_minutes,
                "safety_mode_until": agent.safety_mode_until.isoformat() if agent.safety_mode_until else None,
            }

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    async def madarbot_update_safety_settings(
        agent_id: int,
        safety_mode_enabled: bool | None = None,
        max_actions_per_hour: int | None = None,
        max_messages_per_day: int | None = None,
        min_delay_seconds: float | None = None,
        cooldown_minutes: int | None = None,
    ) -> dict:
        """Update safety settings. Requires MCP_READONLY=false. Safety mode cannot be disabled."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}

        if safety_mode_enabled is False:
            return {"error": "Safety mode cannot be disabled"}

        if max_actions_per_hour and max_actions_per_hour > _MAX_ACTIONS_PER_HOUR:
            return {"error": f"max_actions_per_hour cannot exceed {_MAX_ACTIONS_PER_HOUR}"}

        if max_messages_per_day and max_messages_per_day > _MAX_MESSAGES_PER_DAY:
            return {"error": f"max_messages_per_day cannot exceed {_MAX_MESSAGES_PER_DAY}"}

        if min_delay_seconds is not None and min_delay_seconds < _MIN_DELAY_SECONDS:
            return {"error": f"min_delay_seconds cannot be less than {_MIN_DELAY_SECONDS}"}

        if cooldown_minutes is not None and cooldown_minutes < _MIN_COOLDOWN_MINUTES:
            return {"error": f"cooldown_minutes cannot be less than {_MIN_COOLDOWN_MINUTES}"}

        async with SessionLocal() as session:
            service = AgentService(session)
            agent = await service.get_agent(agent_id=agent_id)
            if agent is None:
                return {"error": "Agent not found"}
            if int(agent.linked_by_user_id) != ctx.actor_user_id:
                return {"error": "Access denied"}

            if safety_mode_enabled is not None:
                agent.safety_mode_enabled = safety_mode_enabled
            if max_actions_per_hour is not None:
                agent.max_actions_per_hour = max_actions_per_hour
            if max_messages_per_day is not None:
                agent.max_messages_per_day = max_messages_per_day
            if min_delay_seconds is not None:
                agent.min_delay_seconds = min_delay_seconds
            if cooldown_minutes is not None:
                agent.cooldown_minutes = cooldown_minutes

            await session.commit()
            return {
                "agent_id": agent.id,
                "safety_mode_enabled": agent.safety_mode_enabled,
                "max_actions_per_hour": agent.max_actions_per_hour,
                "max_messages_per_day": agent.max_messages_per_day,
                "min_delay_seconds": agent.min_delay_seconds,
                "cooldown_minutes": agent.cooldown_minutes,
            }
