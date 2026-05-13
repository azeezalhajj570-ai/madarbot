from __future__ import annotations

import time
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from bot.agents.service import AgentService
from bot.agents.account_group_membership_service import AccountGroupMembershipService
from bot.db.session import SessionLocal
from bot.mcp.context import resolve_mcp_context
from bot.mcp.structured_response import (
    error_response,
    success_response,
    to_mcp_text,
)

_SYNC_COOLDOWNS: dict[int, float] = {}
_SYNC_COOLDOWN_SECONDS = 60


def register_group_tools(server: FastMCP) -> None:

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_list_visible_groups(agent_id: int | None = None) -> str:
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
                        all_groups.append(
                            {
                                "agent_id": m.agent_id,
                                "group_id": m.group_id,
                                "tg_group_id": m.tg_group_id,
                                "title": m.title,
                            }
                        )
            result = success_response(
                content=f"Found {len(all_groups)} visible group{'s' if len(all_groups) != 1 else ''}",
                data={"groups": all_groups, "total": len(all_groups)},
            )
            return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_get_group_members(
        tg_group_id: int,
        agent_id: int,
        query: str | None = None,
        page: int = 1,
        page_size: int = 50000,
    ) -> str:
        """Get members of a group from scraped data. Returns up to 50000 members per page."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AccountGroupMembershipService(session)
            result_data = await service.list_scraped_agent_group_members(
                actor_user_id=ctx.actor_user_id,
                agent_id=agent_id,
                tg_group_id=tg_group_id,
                query=query,
                page=page,
                page_size=page_size,
            )
            members = result_data.get("members", [])
            result = success_response(
                content=f"Found {result_data.get('total', 0)} members",
                data={
                    "tg_group_id": tg_group_id,
                    "agent_id": agent_id,
                    "members": members,
                    "total": result_data.get("total", 0),
                    "page": result_data.get("page", page),
                    "page_size": result_data.get("page_size", page_size),
                },
            )
            return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_start_group_sync(
        agent_id: int,
        tg_group_id: int,
        limit: int = 1000,
        message_limit: int | None = None,
        max_age_days: int | None = None,
    ) -> str:
        """Start scraping group members and messages. Enforces rate limit and max scrape limit of 50000."""
        ctx = resolve_mcp_context()
        if ctx.readonly:
            result = error_response(
                content="Write operations are disabled",
                code="READONLY_MODE",
                message="Set MCP_READONLY=false to enable write operations",
            )
            return to_mcp_text(result)

        now = time.time()
        last_sync = _SYNC_COOLDOWNS.get(tg_group_id, 0)
        if now - last_sync < _SYNC_COOLDOWN_SECONDS:
            remaining = int(_SYNC_COOLDOWN_SECONDS - (now - last_sync))
            result = error_response(
                content=f"Rate limited. Try again in {remaining}s",
                code="RATE_LIMITED",
                message=f"Please wait {remaining} seconds before syncing again",
                details={"retry_after": remaining},
            )
            return to_mcp_text(result)

        effective_limit = min(limit, 50000)
        effective_msg_limit = min(message_limit or limit, 50000) if message_limit else None

        _SYNC_COOLDOWNS[tg_group_id] = now

        async with SessionLocal() as session:
            service = AgentService(session)
            try:
                sync_result = await service.memberships.scrape_agent_member_group(
                    actor_user_id=ctx.actor_user_id,
                    agent_id=agent_id,
                    tg_group_id=tg_group_id,
                    limit=effective_limit,
                    message_limit=effective_msg_limit,
                    max_age_days=max_age_days,
                )
                result = success_response(
                    content="Group sync started successfully",
                    data={
                        "tg_group_id": tg_group_id,
                        "agent_id": agent_id,
                        "sync_started": True,
                        "result": sync_result,
                    },
                )
                return to_mcp_text(result)
            except ValueError as e:
                result = error_response(
                    content=f"Failed to start sync: {e}",
                    code="VALIDATION_ERROR",
                    message=str(e),
                )
                return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_get_sync_status(tg_group_id: int) -> str:
        """Get the last sync status for a group."""
        resolve_mcp_context()
        last_sync = _SYNC_COOLDOWNS.get(tg_group_id, 0)
        if last_sync > 0:
            result = success_response(
                content="Group was recently synced",
                data={
                    "tg_group_id": tg_group_id,
                    "last_sync_at": last_sync,
                    "cooldown_remaining": max(
                        0, int(_SYNC_COOLDOWN_SECONDS - (time.time() - last_sync))
                    ),
                },
            )
            return to_mcp_text(result)
        result = success_response(
            content="No sync history for this group",
            data={"tg_group_id": tg_group_id, "last_sync_at": None},
        )
        return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_get_member_messages(
        agent_id: int,
        tg_group_id: int,
        user_id: int,
        page: int = 1,
        page_size: int = 50000,
    ) -> str:
        """Get messages for a specific member in a scraped group. Returns up to 50000 messages per page."""
        ctx = resolve_mcp_context()
        async with SessionLocal() as session:
            service = AccountGroupMembershipService(session)
            result_data = await service.list_scraped_agent_group_member_messages(
                actor_user_id=ctx.actor_user_id,
                agent_id=agent_id,
                tg_group_id=tg_group_id,
                user_id=user_id,
                page=page,
                page_size=page_size,
            )
            messages = result_data.get("messages", [])
            result = success_response(
                content=f"Found {result_data.get('total', 0)} messages",
                data={
                    "tg_group_id": tg_group_id,
                    "agent_id": agent_id,
                    "user_id": user_id,
                    "messages": messages,
                    "total": result_data.get("total", 0),
                    "page": result_data.get("page", page),
                    "page_size": result_data.get("page_size", page_size),
                },
            )
            return to_mcp_text(result)
