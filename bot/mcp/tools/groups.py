from __future__ import annotations

import time
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

import json

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

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_search_group_messages(
        tg_group_id: int,
        query: str,
        limit: int = 100,
        cursor: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        message_type: str | None = None,
    ) -> str:
        """Full-text search over scraped messages in a group across all senders. Uses cursor-based pagination."""
        ctx = resolve_mcp_context()

        page = 1
        if cursor:
            try:
                cursor_data = json.loads(cursor)
                page = cursor_data.get("page", 1) + 1
            except (json.JSONDecodeError, ValueError):
                result = error_response(
                    content="Invalid cursor",
                    code="INVALID_CURSOR",
                )
                return to_mcp_text(result)

        from datetime import datetime as dt

        parsed_date_from: dt | None = None
        parsed_date_to: dt | None = None
        if date_from:
            try:
                parsed_date_from = dt.fromisoformat(date_from)
            except ValueError:
                result = error_response(
                    content="Invalid date_from format. Use ISO date (e.g. 2024-01-01)",
                    code="INVALID_DATE",
                )
                return to_mcp_text(result)
        if date_to:
            try:
                parsed_date_to = dt.fromisoformat(date_to)
            except ValueError:
                result = error_response(
                    content="Invalid date_to format. Use ISO date (e.g. 2024-01-01)",
                    code="INVALID_DATE",
                )
                return to_mcp_text(result)

        async with SessionLocal() as session:
            from bot.services.scraper_service import ScraperService

            service = ScraperService(session)
            result_data = await service.search_messages(
                tg_group_id=tg_group_id,
                query=query,
                message_type=message_type,
                date_from=parsed_date_from,
                date_to=parsed_date_to,
                page=page,
                page_size=limit,
            )

            messages = result_data.get("messages", [])
            total = result_data.get("total", 0)

            results = [
                {
                    "message_id": m["message_id"],
                    "text": m["message_text"],
                    "date": m["message_date"],
                    "message_type": m["message_type"],
                    "sender_user_id": m["sender_user_id"],
                    "username": m["sender_username"],
                    "full_name": (
                        (m["sender_first_name"] or "")
                        + (" " + m["sender_last_name"] if m.get("sender_last_name") else "")
                    ).strip() or None,
                }
                for m in messages
            ]

            next_cursor = None
            if page * limit < total:
                next_cursor = json.dumps({"page": page})

            result = success_response(
                content=f"Found {total} matching messages",
                data={
                    "tg_group_id": tg_group_id,
                    "query": query,
                    "results": results,
                    "total_matches": total,
                    "cursor": next_cursor,
                },
            )
            return to_mcp_text(result)

    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False),
    )
    async def madarbot_extract_group_knowledge(
        scraped_group_id: int,
        max_messages: int = 2000,
    ) -> str:
        """Extract structured knowledge (FAQs, topics, entities, decisions, consensus) from a scraped group's messages. Uses AI to analyze the last N messages and creates searchable knowledge entries. Max messages: 100-10000."""
        ctx = resolve_mcp_context()
        if max_messages < 100 or max_messages > 10000:
            result = error_response(
                content="max_messages must be between 100 and 10000",
                code="INVALID_PARAMS",
            )
            return to_mcp_text(result)

        from bot.db.models.scraper import ScrapedGroup
        from bot.services.knowledge_extractor import KnowledgeExtractor
        from sqlalchemy import select

        async with SessionLocal() as session:
            group = (
                await session.execute(
                    select(ScrapedGroup).where(ScrapedGroup.id == scraped_group_id)
                )
            ).scalar_one_or_none()
            if group is None:
                result = error_response(
                    content=f"Scraped group {scraped_group_id} not found",
                    code="NOT_FOUND",
                )
                return to_mcp_text(result)

            extractor = KnowledgeExtractor(session)
            try:
                extraction = await extractor.extract_knowledge(
                    scraped_group_id=scraped_group_id,
                    max_messages=max_messages,
                )
                result = success_response(
                    content=f"Extracted {extraction.get('saved', 0)} knowledge entries from group '{group.title or str(scraped_group_id)}'",
                    data={
                        "scraped_group_id": scraped_group_id,
                        "title": group.title,
                        "knowledge_types": extraction.get("knowledge_types", []),
                        "saved": extraction.get("saved", 0),
                        "message_count": extraction.get("message_count", 0),
                        "refined": extraction.get("refined", 0),
                        "total_cost": extraction.get("total_cost", 0),
                    },
                )
                return to_mcp_text(result)
            except Exception as e:
                result = error_response(
                    content=f"Knowledge extraction failed: {e}",
                    code="EXTRACTION_ERROR",
                    message=str(e),
                )
                return to_mcp_text(result)
