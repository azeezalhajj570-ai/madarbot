from __future__ import annotations

import time
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.agents.service import AgentService
from bot.agents.account_group_membership_service import AccountGroupMembershipService
from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context
from bot.services.scraper_service import ScraperService

_SYNC_COOLDOWNS: dict[int, float] = {}
_SYNC_COOLDOWN_SECONDS = 60


def register_group_tools(server: FastMCP) -> None:

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_list_visible_groups(agent_id: int | None = None) -> dict:
        """List groups visible to the MCP actor's linked accounts."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AgentService(session)
            agents = await service.list_all_active_agents(actor_user_id=ctx.actor_user_id)
            if agent_id:
                agents = [a for a in agents if a.id == agent_id]

            all_groups = []
            seen_tg_ids: set[int] = set()
            for agent in agents:
                memberships = await service.list_account_group_visibility(
                    actor_user_id=ctx.actor_user_id,
                    agent_id=agent.id,
                )
                for m in memberships:
                    if m.tg_group_id not in seen_tg_ids:
                        seen_tg_ids.add(m.tg_group_id)
                        all_groups.append({
                            "agent_id": m.agent_id,
                            "group_id": m.group_id,
                            "tg_group_id": m.tg_group_id,
                            "title": m.title,
                        })
            return {"groups": all_groups, "total": len(all_groups)}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_get_group_members(
        tg_group_id: int,
        agent_id: int,
        query: str | None = None,
        page: int = 1,
        page_size: int = 50000,
    ) -> dict:
        """Get members of a group from scraped data. Returns up to 50000 members per page."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AccountGroupMembershipService(session)
            result = await service.list_scraped_agent_group_members(
                actor_user_id=ctx.actor_user_id,
                agent_id=agent_id,
                tg_group_id=tg_group_id,
                query=query,
                page=page,
                page_size=page_size,
            )
            return {
                "tg_group_id": tg_group_id,
                "agent_id": agent_id,
                "members": result.get("members", []),
                "total": result.get("total", 0),
                "page": result.get("page", page),
                "page_size": result.get("page_size", page_size),
            }

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    async def madarbot_start_group_sync(
        agent_id: int,
        tg_group_id: int,
        limit: int = 1000,
        message_limit: int | None = None,
        max_age_days: int | None = None,
    ) -> dict:
        """Start scraping group members and messages. Enforces rate limit and max scrape limit of 50000."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}

        now = time.time()
        last_sync = _SYNC_COOLDOWNS.get(tg_group_id, 0)
        if now - last_sync < _SYNC_COOLDOWN_SECONDS:
            remaining = int(_SYNC_COOLDOWN_SECONDS - (now - last_sync))
            return {"error": f"Rate limited. Try again in {remaining}s"}

        effective_limit = min(limit, 50000)
        effective_msg_limit = min(message_limit or limit, 50000) if message_limit else None

        _SYNC_COOLDOWNS[tg_group_id] = now

        async with SessionLocal() as session:
            service = AgentService(session)
            try:
                result = await service.memberships.scrape_agent_member_group(
                    actor_user_id=ctx.actor_user_id,
                    agent_id=agent_id,
                    tg_group_id=tg_group_id,
                    limit=effective_limit,
                    message_limit=effective_msg_limit,
                    max_age_days=max_age_days,
                )
                return {
                    "tg_group_id": tg_group_id,
                    "agent_id": agent_id,
                    "sync_started": True,
                    "result": result,
                }
            except ValueError as e:
                return {"error": str(e)}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_get_sync_status(tg_group_id: int) -> dict:
        """Get the last sync status for a group."""
        ctx = resolve_mcp_context()
        last_sync = _SYNC_COOLDOWNS.get(tg_group_id, 0)
        if last_sync > 0:
            return {
                "tg_group_id": tg_group_id,
                "last_sync_at": last_sync,
                "cooldown_remaining": max(0, int(_SYNC_COOLDOWN_SECONDS - (time.time() - last_sync))),
            }
        return {"tg_group_id": tg_group_id, "last_sync_at": None}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
    async def madarbot_get_member_messages(
        agent_id: int,
        tg_group_id: int,
        user_id: int,
        page: int = 1,
        page_size: int = 50000,
    ) -> dict:
        """Get messages for a specific member in a scraped group. Returns up to 50000 messages per page."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AccountGroupMembershipService(session)
            result = await service.list_scraped_agent_group_member_messages(
                actor_user_id=ctx.actor_user_id,
                agent_id=agent_id,
                tg_group_id=tg_group_id,
                user_id=user_id,
                page=page,
                page_size=page_size,
            )
            return {
                "tg_group_id": tg_group_id,
                "agent_id": agent_id,
                "user_id": user_id,
                "messages": result.get("messages", []),
                "total": result.get("total", 0),
                "page": result.get("page", page),
                "page_size": result.get("page_size", page_size),
            }
