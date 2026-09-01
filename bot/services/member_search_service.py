"""Member search service — orchestrates the dynamic member search pipeline.

Resolves the agent scope (visible groups, tenant, agent-owned scraped rows),
then runs validator → normalizer → planner → compiler → repository, and returns
a paginated member page. The service owns no SQL string building — all of that
lives in bot/search.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import structlog
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.agents.service_support import AgentServiceSupport
from bot.db.models import Agent, ScrapedGroup, ScrapedMember
from bot.search.exceptions import FilterValidationError
from bot.search.filter_ast import FilterNode, from_dict
from bot.search.filter_normalizer import normalize
from bot.search.filter_validator import validate_filter, validate_group_ids, validate_sort
from bot.search.member_search_repository import MemberSearchRepository
from bot.search.query_compiler import (
    compile_count_select,
    compile_member_select,
    compile_scope_filter,
)
from bot.search.query_planner import SearchContext, plan

logger = structlog.get_logger(__name__)

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 50


class MemberSearchService(AgentServiceSupport):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)

    async def search_members(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
        group_ids: list[int] | None = None,
        filter_data: dict[str, Any] | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        page: int = 1,
        page_size: int = DEFAULT_PAGE_SIZE,
        sort: str = "newest_matching_activity",
        include_total: bool = False,
    ) -> dict[str, Any]:
        """Run a member search and return a paginated page of members.

        Raises FilterValidationError / SearchQueryTooComplexError (both
        ValueError subclasses) on invalid filters — the router maps them to 422.
        """
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)

        normalized_page = max(1, int(page))
        normalized_page_size = max(1, min(int(page_size), MAX_PAGE_SIZE))
        validate_sort(sort)

        # ── Scope resolution ────────────────────────────────────────────────
        visible_group_ids = await self._visible_group_ids(agent)
        requested_group_ids = validate_group_ids(group_ids)
        if requested_group_ids:
            disallowed = [g for g in requested_group_ids if g not in visible_group_ids]
            if disallowed:
                raise FilterValidationError(
                    f"Group ids {disallowed} are not visible to this agent",
                    code="GROUP_NOT_VISIBLE",
                    field="group_ids",
                )
            scope_group_ids = requested_group_ids
        else:
            scope_group_ids = visible_group_ids

        if not scope_group_ids:
            return self._empty_result(normalized_page, normalized_page_size)

        # ── Tenant for claim conditions ─────────────────────────────────────
        tenant_id: int | None = agent.tenant_id
        if tenant_id is None and agent.linked_by_user_id is not None:
            tenant_id = await self.resolve_actor_tenant_id(agent.linked_by_user_id)

        # ── Parse + validate + normalize the filter ────────────────────────
        if filter_data is None:
            filter_data = {"type": "group", "operator": "AND", "conditions": []}
        node: FilterNode = from_dict(filter_data)
        validate_filter(node)
        node = normalize(node)

        context = SearchContext(
            group_ids=scope_group_ids,
            date_range={"from": date_from, "to": date_to} if (date_from or date_to) else None,
            agent_id=agent.id,
            tenant_id=tenant_id,
            exclude_self_user_id=agent.telegram_user_id,
        )

        planned = plan(node, context)

        scope_filter = compile_scope_filter(context)
        stmt = compile_member_select(
            planned=planned,
            context=context,
            sort=sort,
            page=normalized_page,
            page_size=normalized_page_size,
            scope_filter=scope_filter,
        )
        count_stmt = (
            compile_count_select(planned=planned, context=context, scope_filter=scope_filter)
            if include_total
            else None
        )

        result = await MemberSearchRepository(self.session).fetch_page(
            stmt=stmt,
            count_stmt=count_stmt,
            page=normalized_page,
            page_size=normalized_page_size,
            include_total=include_total,
        )

        logger.info(
            "member_search_completed",
            actor_user_id=actor_user_id,
            agent_id=agent.id,
            group_ids=len(scope_group_ids),
            sort=sort,
            page=normalized_page,
            items=len(result["items"]),
            has_more=result["has_more"],
        )
        return result

    # ── Scope helpers ──────────────────────────────────────────────────────

    async def _visible_group_ids(self, agent: Agent) -> list[int]:
        """Visible scraped groups for an agent (mirrors AccountGroupMembershipService):

        scraped_groups.last_agent_id == agent.id  OR  the agent is a scraped
        member of the group (scraped_members.tg_user_id == agent.telegram_user_id).
        """
        agent_tg_id = agent.telegram_user_id
        conditions = [ScrapedGroup.last_agent_id == agent.id]
        if agent_tg_id is not None:
            member_subq = (
                select(ScrapedMember.scraped_group_id)
                .where(ScrapedMember.tg_user_id == agent_tg_id)
                .distinct()
            )
            conditions.append(ScrapedGroup.id.in_(member_subq))
        rows = (
            await self.session.execute(select(ScrapedGroup.tg_group_id).where(or_(*conditions)))
        ).all()
        return [int(r[0]) for r in rows]

    @staticmethod
    def _empty_result(page: int, page_size: int) -> dict[str, Any]:
        return {
            "items": [],
            "page": page,
            "page_size": page_size,
            "has_more": False,
            "total": 0,
        }
