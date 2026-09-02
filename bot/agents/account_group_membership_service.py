from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy import String, and_, asc, cast, desc, func, inspect, nullslast, or_, select
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from bot.agents.contracts import AccountGroupVisibility
from bot.agents.session import SessionManager
from bot.db.models import (
    Agent,
    AgentJob,
    Group,
    GroupAdminRole,
    GroupMember,
    ScrapedGroup,
    ScrapedMember,
    ScrapedMessage,
    User,
)
from bot.db.models.agent import SentBroadcastMessage
from bot.db.models.bulk_messaging import AgentBlacklistEntry
from bot.db.models.member_claim import MemberClaim
from bot.db.models.member_operation import MemberOperation
from bot.services.group_service import canonical_tg_group_id
from bot.services.scraper_service import ScraperService

from .agent_notification_service import AgentNotificationService
from .service_support import AgentServiceSupport

logger = structlog.get_logger(__name__)


def _is_missing_scraper_table_error(exc: Exception) -> bool:
    message = str(getattr(exc, "orig", exc)).lower()
    return "undefinedtableerror" in message or 'relation "scraped_' in message


class AccountGroupMembershipService(AgentServiceSupport):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)
        self._scraper_tables_available: bool | None = None

    async def _has_scraper_tables(self) -> bool:
        if self._scraper_tables_available is not None:
            return self._scraper_tables_available
        connection = await self.session.connection()

        def check_tables(sync_connection) -> bool:
            inspector = inspect(sync_connection)
            return bool(
                inspector.has_table("scraped_groups") and inspector.has_table("scraped_members")
            )

        if hasattr(connection, "run_sync"):
            self._scraper_tables_available = await connection.run_sync(check_tables)
        else:
            self._scraper_tables_available = check_tables(connection)
        return self._scraper_tables_available

    async def list_managed_member_groups(
        self, *, actor_user_id: int, agent_id: int, query: str | None = None
    ) -> list[dict[str, Any]]:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            return []
        await self.ensure_agent_owner(agent, actor_user_id)
        if agent.auth_state != "active" or not agent.session_string:
            return []

        if not await self._has_scraper_tables():
            return []

        try:
            normalized_query = str(query or "").strip()
            word_conditions = []

            query_words = [w.strip() for w in normalized_query.split() if len(w.strip()) >= 1]
            for word in query_words:
                if word in {"-", "_", ".", ","} and len(query_words) > 1:
                    continue

                safe_word = word.replace("%", "\\%").replace("_", "\\_")
                pattern = f"%{safe_word}%"
                word_conditions.append(
                    or_(
                        ScrapedGroup.title.ilike(pattern),
                        ScrapedGroup.username.ilike(pattern),
                        cast(ScrapedGroup.tg_group_id, String).like(pattern),
                    )
                )

            if normalized_query and not word_conditions:
                return []

            agent_group_ids_subq = (
                select(ScrapedMember.scraped_group_id)
                .where(ScrapedMember.tg_user_id == agent.telegram_user_id)
                .distinct()
            )
            filters = [
                or_(
                    ScrapedGroup.id.in_(agent_group_ids_subq),
                    ScrapedGroup.last_agent_id == agent.id,
                ),
                ScrapedGroup.group_type != "channel",
            ]
            filters.extend(word_conditions)
            stmt = (
                select(ScrapedGroup)
                .where(and_(*filters))
                .order_by(ScrapedGroup.title, ScrapedGroup.id)
                .limit(100 if normalized_query else 500)
            )

            scraped_rows_all = (await self.session.execute(stmt)).scalars().all()
            seen: set[int] = set()
            scraped_rows: list[ScrapedGroup] = []
            for row in scraped_rows_all:
                tid = int(row.tg_group_id)
                if tid in seen:
                    continue
                seen.add(tid)
                scraped_rows.append(row)

            if not scraped_rows:
                return []

            member_counts = {
                int(row.scraped_group_id): int(row.member_count)
                for row in (
                    await self.session.execute(
                        select(
                            ScrapedMember.scraped_group_id,
                            func.count(func.distinct(ScrapedMember.tg_user_id)).label(
                                "member_count"
                            ),
                        )
                        .where(
                            ScrapedMember.scraped_group_id.in_([int(r.id) for r in scraped_rows])
                        )
                        .group_by(ScrapedMember.scraped_group_id)
                    )
                ).all()
            }
            message_counts = {
                int(row.scraped_group_id): int(row.message_count)
                for row in (
                    await self.session.execute(
                        select(
                            ScrapedMessage.scraped_group_id,
                            func.count(ScrapedMessage.id).label("message_count"),
                        )
                        .where(
                            ScrapedMessage.scraped_group_id.in_([int(r.id) for r in scraped_rows])
                        )
                        .group_by(ScrapedMessage.scraped_group_id)
                    )
                ).all()
            }

            agent_tg_id = agent.telegram_user_id
            admin_group_ids: set[int] = set()
            if agent_tg_id is not None and scraped_rows:
                tg_ids = [int(r.tg_group_id) for r in scraped_rows]
                admin_rows = (
                    await self.session.execute(
                        select(ScrapedMember.tg_group_id).where(
                            ScrapedMember.tg_user_id == agent_tg_id,
                            ScrapedMember.tg_group_id.in_(tg_ids),
                            ScrapedMember.role.in_(["admin", "creator"]),
                        )
                    )
                ).all()
                admin_group_ids = {int(r.tg_group_id) for r in admin_rows}

            agent_member_group_ids: set[int] = set()
            if agent_tg_id is not None and scraped_rows:
                tg_ids = [int(r.tg_group_id) for r in scraped_rows]
                member_rows = (
                    await self.session.execute(
                        select(ScrapedMember.tg_group_id).where(
                            ScrapedMember.tg_user_id == agent_tg_id,
                            ScrapedMember.tg_group_id.in_(tg_ids),
                        )
                    )
                ).all()
                agent_member_group_ids = {int(r.tg_group_id) for r in member_rows}

            results = []
            for row in scraped_rows:
                tg_group_id = int(row.tg_group_id)
                # Bulk-add eligibility is based on the agent's actual membership
                # in the group, not on admin/creator status and not on
                # last_agent_id (which is a scraped-data ownership marker only).
                # Telegram remains the final authority over each add operation.
                is_member = tg_group_id in agent_member_group_ids
                results.append(
                    {
                        "id": row.id,
                        "tg_group_id": tg_group_id,
                        "title": row.title or str(row.tg_group_id),
                        "username": row.username,
                        "group_type": row.group_type,
                        "member_count": member_counts.get(int(row.id), int(row.member_count or 0)),
                        "messages_count": message_counts.get(int(row.id), 0),
                        "is_member": is_member,
                        "is_admin": tg_group_id in admin_group_ids,
                        "can_add_members": is_member,
                        "can_send_messages": is_member,
                    }
                )
            return results

        except ProgrammingError as exc:
            if not _is_missing_scraper_table_error(exc):
                raise
            return []

    async def list_account_group_visibility(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
    ) -> list[AccountGroupVisibility]:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            return []
        groups = await self.list_managed_member_groups(
            actor_user_id=actor_user_id, agent_id=agent_id
        )

        tg_ids = {int(g["tg_group_id"]) for g in groups}
        group_id_map: dict[int, int] = {}
        if tg_ids:
            group_rows = (
                await self.session.execute(
                    select(Group.id, Group.tg_group_id).where(Group.tg_group_id.in_(tg_ids))
                )
            ).all()
            for row in group_rows:
                key = canonical_tg_group_id(int(row.tg_group_id))
                group_id_map[key] = int(row.id)

        return [
            AccountGroupVisibility(
                agent_id=agent.id,
                group_id=group_id_map.get(
                    canonical_tg_group_id(int(group["tg_group_id"])), agent.group_id
                ),
                tg_group_id=int(group["tg_group_id"]),
                title=str(group["title"]),
            )
            for group in groups
        ]

    async def search_agent_member_group_members(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
        tg_group_id: int,
        query: str | None = None,
        limit: int = 25,
    ) -> list[dict[str, Any]]:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)
        if agent.auth_state != "active" or not agent.session_string:
            raise ValueError("Link an active agent first to browse group members")

        normalized_query = str(query or "").strip()
        normalized_limit = max(1, min(int(limit), 50))
        client = await SessionManager().get_client(agent.id)
        try:
            members: list[dict[str, Any]] = []
            async for participant in client.iter_participants(
                entity=int(tg_group_id), search=normalized_query, limit=normalized_limit
            ):
                user_id = getattr(participant, "id", None)
                if (
                    user_id is None
                    or bool(getattr(participant, "bot", False))
                    or bool(getattr(participant, "deleted", False))
                ):
                    continue
                first_name = str(getattr(participant, "first_name", None) or "").strip()
                last_name = str(getattr(participant, "last_name", None) or "").strip()
                full_name = (
                    " ".join(part for part in [first_name, last_name] if part).strip() or None
                )
                role = "member"
                if hasattr(participant, "creator") and participant.creator:
                    role = "creator"
                elif hasattr(participant, "admin_rights") and participant.admin_rights:
                    role = "admin"
                elif hasattr(participant, "banned_rights") and participant.banned_rights:
                    role = "restricted"
                members.append(
                    {
                        "user_id": int(user_id),
                        "username": getattr(participant, "username", None),
                        "full_name": full_name,
                        "role": role,
                        "is_admin": role in {"admin", "creator"},
                        "is_creator": role == "creator",
                    }
                )
        finally:
            await client.disconnect()

        await self._sync_users(members)
        logger.info(
            "agent_member_lookup_completed",
            actor_user_id=actor_user_id,
            group_id=agent.group_id,
            tg_group_id=int(tg_group_id),
            agent_id=agent.id,
            query=normalized_query,
            count=len(members),
        )
        return members

    async def search_group_members(
        self,
        *,
        actor_user_id: int,
        group_id: int,
        query: str | None = None,
        limit: int = 25,
    ) -> list[dict[str, Any]]:
        await self.ensure_group_admin(group_id, actor_user_id)
        group = (
            await self.session.execute(select(Group).where(Group.id == group_id))
        ).scalar_one_or_none()
        if group is None:
            raise ValueError("Group not found")

        agent = (
            await self.session.execute(
                select(Agent)
                .where(
                    Agent.group_id == group_id,
                    Agent.auth_state == "active",
                    Agent.session_string.is_not(None),
                )
                .order_by(desc(Agent.updated_at), desc(Agent.id))
            )
        ).scalar_one_or_none()
        if agent is None:
            raise ValueError("Link an active agent first to browse group members")

        normalized_query = str(query or "").strip()
        normalized_limit = max(1, min(int(limit), 50))
        client = await SessionManager().get_client(agent.id)
        try:
            members: list[dict[str, Any]] = []
            async for participant in client.iter_participants(
                entity=group.tg_group_id, search=normalized_query, limit=normalized_limit
            ):
                user_id = getattr(participant, "id", None)
                if (
                    user_id is None
                    or bool(getattr(participant, "bot", False))
                    or bool(getattr(participant, "deleted", False))
                ):
                    continue
                first_name = str(getattr(participant, "first_name", None) or "").strip()
                last_name = str(getattr(participant, "last_name", None) or "").strip()
                full_name = (
                    " ".join(part for part in [first_name, last_name] if part).strip() or None
                )
                members.append(
                    {
                        "user_id": int(user_id),
                        "username": getattr(participant, "username", None),
                        "full_name": full_name,
                    }
                )
        finally:
            await client.disconnect()

        user_ids = [int(member["user_id"]) for member in members]
        role_map: dict[int, str] = {}
        if user_ids:
            role_rows = (
                await self.session.execute(
                    select(GroupAdminRole.user_id, GroupAdminRole.role).where(
                        GroupAdminRole.group_id == group_id, GroupAdminRole.user_id.in_(user_ids)
                    )
                )
            ).all()
            role_map = {int(row.user_id): str(row.role) for row in role_rows}

        await self._sync_users(members)
        for member in members:
            member["role"] = role_map.get(int(member["user_id"]), "member")
        logger.info(
            "agent_member_lookup_completed",
            actor_user_id=actor_user_id,
            group_id=group_id,
            agent_id=agent.id,
            query=normalized_query,
            count=len(members),
        )
        return members

    async def list_scraped_agent_group_members(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
        tg_group_id: int,
        query: str | None = None,
        page: int = 1,
        page_size: int = 10,
        exclude_admins: bool = False,
        exclude_bots: bool = True,
        only_admins: bool = False,
        only_bots: bool = False,
        exclude_self: bool = True,
        order_by: str = "message_count",
        target_tg_group_id: int | None = None,
        member_ids: list[int] | None = None,
    ) -> dict[str, Any]:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)

        canonical_id = canonical_tg_group_id(int(tg_group_id))
        normalized_query = str(query or "").strip()
        normalized_page = max(1, int(page))
        normalized_page_size = max(1, min(int(page_size), 50))

        if not await self._has_scraper_tables():
            return {
                "members": [],
                "total": 0,
                "page": normalized_page,
                "page_size": normalized_page_size,
            }

        scraped_group = await self._get_scraped_group(canonical_id)
        if scraped_group is None:
            await self._ensure_agent_group_visible(agent=agent, tg_group_id=tg_group_id)
        filters = [
            (ScrapedMember.scraped_group_id == scraped_group.id)
            if scraped_group is not None
            else (ScrapedMember.tg_group_id == canonical_id)
        ]
        # Only offer members whose entity data (access_hash) was captured by the
        # current agent's own session — otherwise the add cannot resolve them.
        # Legacy rows scraped before agent attribution (NULL) are still offered.
        filters.append(
            or_(
                ScrapedMember.scraped_by_agent_id == agent.id,
                ScrapedMember.scraped_by_agent_id.is_(None),
            )
        )
        if exclude_bots:
            filters.append(ScrapedMember.is_bot.is_(False))
        if exclude_admins:
            filters.append(ScrapedMember.role.notin_(["admin", "creator"]))
        if only_admins:
            filters.append(ScrapedMember.role.in_(["admin", "creator"]))
        if only_bots:
            filters.append(ScrapedMember.is_bot.is_(True))
        if exclude_self and agent.telegram_user_id is not None:
            filters.append(ScrapedMember.tg_user_id != agent.telegram_user_id)
        if normalized_query:
            safe_query = normalized_query.replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{safe_query.lower()}%"
            filters.append(
                or_(
                    func.lower(func.coalesce(ScrapedMember.username, "")).like(pattern),
                    func.lower(func.coalesce(ScrapedMember.full_name, "")).like(pattern),
                    func.lower(func.coalesce(ScrapedMember.first_name, "")).like(pattern),
                    func.lower(func.coalesce(ScrapedMember.last_name, "")).like(pattern),
                    cast(ScrapedMember.tg_user_id, String).like(f"%{normalized_query}%"),
                )
            )

        blacklisted_tg_subq = (
            select(AgentBlacklistEntry.tg_user_id).where(
                AgentBlacklistEntry.agent_id == agent.id,
                AgentBlacklistEntry.tg_user_id.isnot(None),
            )
        ).subquery()
        filters.append(ScrapedMember.tg_user_id.notin_(select(blacklisted_tg_subq)))

        blacklisted_username_subq = (
            select(func.lower(AgentBlacklistEntry.username)).where(
                AgentBlacklistEntry.agent_id == agent.id,
                AgentBlacklistEntry.username.isnot(None),
            )
        ).subquery()
        filters.append(
            func.lower(func.coalesce(ScrapedMember.username, "")).notin_(
                select(blacklisted_username_subq)
            )
        )

        blacklisted_phone_subq = (
            select(AgentBlacklistEntry.phone).where(
                AgentBlacklistEntry.agent_id == agent.id,
                AgentBlacklistEntry.phone.isnot(None),
            )
        ).subquery()
        filters.append(
            func.coalesce(ScrapedMember.phone, "").notin_(select(blacklisted_phone_subq))
        )

        already_sent_subq = (
            select(SentBroadcastMessage.tg_user_id).where(
                SentBroadcastMessage.agent_id == agent.id,
                SentBroadcastMessage.tg_group_id == canonical_id,
                SentBroadcastMessage.status == "sent",
                SentBroadcastMessage.tg_user_id.isnot(None),
            )
        ).subquery()
        filters.append(ScrapedMember.tg_user_id.notin_(select(already_sent_subq)))

        # Optional advanced-filter narrowing: only members whose tg_user_id is
        # in this set (resolved by the dynamic member-search endpoint) are
        # returned. Applied server-side so pagination + total reflect the
        # filtered set, not the whole group.
        if member_ids:
            filters.append(ScrapedMember.tg_user_id.in_(member_ids))

        try:
            total = int(
                (
                    await self.session.execute(select(func.count(ScrapedMember.id)).where(*filters))
                ).scalar_one()
                or 0
            )

            base_query = select(
                ScrapedMember.tg_user_id,
                ScrapedMember.username,
                ScrapedMember.full_name,
                ScrapedMember.role,
                ScrapedMember.is_bot,
                ScrapedMember.phone,
                ScrapedMember.raw_data,
            )

            if order_by == "message_count":
                msg_count_subq = (
                    select(
                        ScrapedMessage.sender_user_id,
                        func.count(ScrapedMessage.id).label("message_count"),
                    )
                    .where(ScrapedMessage.tg_group_id == canonical_id)
                    .group_by(ScrapedMessage.sender_user_id)
                    .subquery()
                )
                base_query = base_query.outerjoin(
                    msg_count_subq,
                    ScrapedMember.tg_user_id == msg_count_subq.c.sender_user_id,
                )
                order_columns = [
                    nullslast(desc(msg_count_subq.c.message_count)),
                    desc(ScrapedMember.tg_user_id),
                ]
            elif order_by == "message_count_asc":
                msg_count_subq = (
                    select(
                        ScrapedMessage.sender_user_id,
                        func.count(ScrapedMessage.id).label("message_count"),
                    )
                    .where(ScrapedMessage.tg_group_id == canonical_id)
                    .group_by(ScrapedMessage.sender_user_id)
                    .subquery()
                )
                base_query = base_query.outerjoin(
                    msg_count_subq,
                    ScrapedMember.tg_user_id == msg_count_subq.c.sender_user_id,
                )
                order_columns = [
                    nullslast(asc(msg_count_subq.c.message_count)),
                    desc(ScrapedMember.tg_user_id),
                ]
            else:
                order_columns = [desc(ScrapedMember.scraped_at), desc(ScrapedMember.id)]

            rows = (
                await self.session.execute(
                    base_query.where(*filters)
                    .order_by(*order_columns)
                    .offset((normalized_page - 1) * normalized_page_size)
                    .limit(normalized_page_size)
                )
            ).all()
        except ProgrammingError as exc:
            if not _is_missing_scraper_table_error(exc):
                raise
            logger.warning(
                "scraper_tables_missing_for_scraped_agent_group_members",
                agent_id=agent.id,
                tg_group_id=canonical_id,
            )
            total = 0
            rows = []

        user_ids = [int(member.tg_user_id) for member in rows if member.tg_user_id is not None]
        message_counts: dict[int, int] = {}
        if user_ids:
            message_counts = {
                int(row.sender_user_id): int(row.message_count)
                for row in (
                    await self.session.execute(
                        select(
                            ScrapedMessage.sender_user_id,
                            func.count(ScrapedMessage.id).label("message_count"),
                        )
                        .where(
                            ScrapedMessage.tg_group_id == canonical_id,
                            ScrapedMessage.sender_user_id.in_(user_ids),
                        )
                        .group_by(ScrapedMessage.sender_user_id)
                    )
                ).all()
                if row.sender_user_id is not None
            }

        sent_to: set[int] = set()
        if user_ids:
            broadcast_jobs = (
                (
                    await self.session.execute(
                        select(AgentJob.job_payload)
                        .where(
                            AgentJob.agent_id == agent.id,
                            AgentJob.job_type == "group_member_broadcast",
                            AgentJob.status == "completed",
                        )
                        .order_by(desc(AgentJob.id))
                        .limit(20)
                    )
                )
                .scalars()
                .all()
            )
            for job_payload in (j for j in broadcast_jobs if j):
                source_group_id = int(job_payload.get("source_group_id") or 0)
                if source_group_id != canonical_id:
                    continue
                progress = job_payload.get("progress") or {}
                sent_users = progress.get("sent_users") or []
                for uid in sent_users:
                    sent_to.add(int(uid))

        # Query active claims for these members
        member_claims: dict[int, dict[str, Any]] = {}  # tg_user_id -> claim info
        if user_ids and scraped_group:
            claim_rows = (
                (
                    await self.session.execute(
                        select(MemberClaim).where(
                            MemberClaim.tenant_id == agent.tenant_id,
                            MemberClaim.scraped_group_id == scraped_group.id,
                            MemberClaim.tg_user_id.in_(user_ids),
                            MemberClaim.status == "active",
                        )
                    )
                )
                .scalars()
                .all()
            )
            for claim in claim_rows:
                tg_uid = int(claim.tg_user_id)
                member_claims[tg_uid] = {
                    "claim_id": claim.id,
                    "agent_id": claim.agent_id,
                    "is_own": claim.agent_id == agent.id,
                    "expires_at": claim.expires_at.isoformat() if claim.expires_at else None,
                }

        # Query invitation status for these members (for the target group, if provided).
        # Scoped to the whole workspace (all agents sharing agent.tenant_id) so that
        # an invite sent by one agent is visible to every other agent in the workspace.
        # "joined" operations mean the member accepted the invite and is now in the group,
        # so they are treated as both already-invited and already-added.
        invitation_status: dict[
            int, dict[str, Any]
        ] = {}  # tg_user_id -> {status, sent_at, invitation_link, agent_id}
        if user_ids and target_tg_group_id:
            workspace_agent_ids: set[int] = set()
            if agent.tenant_id is not None:
                ws_agents = (
                    await self.session.execute(
                        select(Agent.id).where(Agent.tenant_id == agent.tenant_id)
                    )
                ).all()
                workspace_agent_ids = {int(row[0]) for row in ws_agents}
            if workspace_agent_ids:
                op_rows = (
                    (
                        await self.session.execute(
                            select(MemberOperation).where(
                                MemberOperation.tg_group_id == target_tg_group_id,
                                MemberOperation.tg_user_id.in_(user_ids),
                                MemberOperation.agent_id.in_(workspace_agent_ids),
                                MemberOperation.status.in_(["pending", "sent", "joined"]),
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                for op in op_rows:
                    invitation_status[int(op.tg_user_id)] = {
                        "status": op.status,
                        "sent_at": op.sent_at.isoformat() if op.sent_at else None,
                        "invitation_link": op.invitation_link,
                        "agent_id": op.agent_id,
                        "is_own": op.agent_id == agent.id,
                    }

        # Members already processed by a direct-add attempt (any outcome).
        # These were offered in a bulk add job already, so they should not be
        # re-offered in the member list.
        processed_direct_add: dict[int, str | None] = {}  # tg_user_id -> failure_reason
        privacy_restricted: set[int] = set()  # tg_user_ids that hit USER_PRIVACY_RESTRICTED
        # tg_user_ids whose direct-add attempt failed ONLY because of a Telegram
        # privacy restriction. They were never actually added, so a new bulk-add
        # job may re-attempt them (see issue #295).
        retryable_privacy_restricted: set[int] = set()
        if user_ids and target_tg_group_id:
            da_rows = (
                await self.session.execute(
                    select(MemberOperation.tg_user_id, MemberOperation.failure_reason).where(
                        MemberOperation.tg_group_id == target_tg_group_id,
                        MemberOperation.tg_user_id.in_(user_ids),
                        MemberOperation.operation_type == "direct_add",
                    )
                )
            ).all()
            for row in da_rows:
                processed_direct_add[int(row[0])] = row[1]
                if row[1] == "USER_PRIVACY_RESTRICTED":
                    privacy_restricted.add(int(row[0]))
                    retryable_privacy_restricted.add(int(row[0]))

        # Members already present in the target group. This is workspace-independent:
        # a member added by any agent (directly or via invite join) is a member of the group.
        already_added: set[int] = set()
        if user_ids and target_tg_group_id:
            target_group_id_row = (
                await self.session.execute(
                    select(Group.id).where(Group.tg_group_id == target_tg_group_id)
                )
            ).first()
            if target_group_id_row:
                target_group_db_id = int(target_group_id_row[0])
                gm_rows = (
                    await self.session.execute(
                        select(GroupMember.tg_user_id).where(
                            GroupMember.group_id == target_group_db_id,
                            GroupMember.tg_user_id.in_(user_ids),
                        )
                    )
                ).all()
                already_added = {int(row[0]) for row in gm_rows}

        # Members whose invitation operation was confirmed "joined" are already in
        # the group even though no GroupMember row was created for the invite path.
        already_added.update(
            int(uid) for uid, info in invitation_status.items() if info.get("status") == "joined"
        )

        def _member_dict(member) -> dict[str, Any]:
            role = member.role or "member"
            tg_uid = int(member.tg_user_id)
            claim_info = member_claims.get(tg_uid)
            inv_info = invitation_status.get(tg_uid)
            return {
                "user_id": tg_uid,
                "username": member.username,
                "full_name": member.full_name,
                "phone": member.phone,
                "role": role,
                "is_admin": role in {"admin", "creator"},
                "is_creator": role == "creator",
                "message_count": message_counts.get(tg_uid, 0),
                "is_bot": bool((member.raw_data or {}).get("bot", member.is_bot)),
                "sent_by_agent": tg_uid in sent_to,
                "claim": claim_info,
                "invitation_status": inv_info,
                "already_added": tg_uid in already_added,
                "processed": tg_uid in processed_direct_add,
                "processing_error": processed_direct_add.get(tg_uid),
                "privacy_restricted": tg_uid in privacy_restricted,
                # A member is retryable when the only prior direct-add failure was
                # USER_PRIVACY_RESTRICTED AND they are not already in the target
                # group (already_added may include members who joined via invite).
                "retryable": (
                    tg_uid in retryable_privacy_restricted and tg_uid not in already_added
                ),
            }

        return {
            "members": [_member_dict(member) for member in rows],
            "total": total,
            "page": normalized_page,
            "page_size": normalized_page_size,
        }

    async def list_scraped_agent_group_member_messages(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
        tg_group_id: int,
        user_id: int,
        page: int = 1,
        page_size: int = 25,
    ) -> dict[str, Any]:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)

        canonical_id = canonical_tg_group_id(int(tg_group_id))
        normalized_page = max(1, int(page))
        normalized_page_size = max(1, min(int(page_size), 100))

        if not await self._has_scraper_tables():
            return {
                "messages": [],
                "total": 0,
                "page": normalized_page,
                "page_size": normalized_page_size,
            }

        scraped_group = await self._get_scraped_group(canonical_id)
        if scraped_group is None:
            await self._ensure_agent_group_visible(agent=agent, tg_group_id=tg_group_id)

        filters = [
            (ScrapedMessage.scraped_group_id == scraped_group.id)
            if scraped_group is not None
            else (ScrapedMessage.tg_group_id == canonical_id),
            ScrapedMessage.sender_user_id == int(user_id),
        ]

        try:
            total = int(
                (
                    await self.session.execute(
                        select(func.count(ScrapedMessage.id)).where(*filters)
                    )
                ).scalar_one()
                or 0
            )
            rows = (
                await self.session.execute(
                    select(
                        ScrapedMessage.message_id,
                        ScrapedMessage.message_text,
                        ScrapedMessage.message_date,
                        ScrapedMessage.message_type,
                        ScrapedMessage.sender_username,
                        ScrapedMessage.sender_first_name,
                        ScrapedMessage.sender_last_name,
                    )
                    .where(*filters)
                    .order_by(desc(ScrapedMessage.message_date), desc(ScrapedMessage.id))
                    .offset((normalized_page - 1) * normalized_page_size)
                    .limit(normalized_page_size)
                )
            ).all()
        except ProgrammingError as exc:
            if not _is_missing_scraper_table_error(exc):
                raise
            logger.warning(
                "scraper_tables_missing_for_scraped_agent_group_member_messages",
                agent_id=agent.id,
                tg_group_id=canonical_id,
                user_id=int(user_id),
            )
            total = 0
            rows = []

        return {
            "messages": [
                {
                    "message_id": int(row.message_id),
                    "text": row.message_text,
                    "date": row.message_date.isoformat() if row.message_date else None,
                    "message_type": row.message_type,
                    "username": row.sender_username,
                    "full_name": " ".join(
                        part
                        for part in [
                            str(row.sender_first_name or "").strip(),
                            str(row.sender_last_name or "").strip(),
                        ]
                        if part
                    ).strip()
                    or None,
                }
                for row in rows
            ],
            "total": total,
            "page": normalized_page,
            "page_size": normalized_page_size,
        }

    async def scrape_agent_member_group(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
        tg_group_id: int,
        limit: int = 500,
        message_limit: int | None = None,
        max_age_days: int | None = None,
    ) -> dict[str, Any]:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)
        session_string = agent.session_string
        if agent.auth_state != "active" or not session_string:
            raise ValueError("Link an active agent first to scrape group members")
        await self._ensure_agent_group_visible(agent=agent, tg_group_id=tg_group_id)
        results = await ScraperService(self.session).scrape_full_group(
            agent_id=agent.id,
            tg_group_id=tg_group_id,
            scrape_members=True,
            scrape_messages=True,
            member_limit=limit,
            message_limit=max(1, min(int(message_limit or limit), 1_000_000)),
            max_age_days=max_age_days,
            scan_strategy="checkpoint",
        )
        response = {
            **results["members"],
            "messages_count": int(results["messages"].get("success_count") or 0),
            "messages_total_scraped": int(results["messages"].get("total_scraped") or 0),
            "members_from_messages": int(results["messages"].get("member_success_count") or 0),
        }
        visible_groups = await self._list_agent_member_groups(agent)
        group_title = next(
            (
                str(group.get("title") or "")
                for group in visible_groups
                if int(group.get("tg_group_id") or 0) == canonical_tg_group_id(int(tg_group_id))
            ),
            str(tg_group_id),
        )

        # Combine unique counts if possible, but for notification, simple sum is better than just "2"
        total_members_synced = int(response["success_count"]) + int(
            response["members_from_messages"]
        )

        await AgentNotificationService(self.session).create_notification(
            actor_user_id=actor_user_id,
            agent=agent,
            kind="scrape_completed",
            title="Scrape finished",
            body=(
                f"{group_title}: {total_members_synced} members synced, "
                f"{int(response['messages_count'])} messages scraped."
            ),
            payload={
                "tg_group_id": canonical_tg_group_id(int(tg_group_id)),
                "group_title": group_title,
                "success_count": total_members_synced,
                "messages_count": int(response["messages_count"]),
                "total_scraped": int(response["total_scraped"]),
                "messages_total_scraped": int(response["messages_total_scraped"]),
                "members_direct": int(response["success_count"]),
                "members_from_messages": int(response["members_from_messages"]),
            },
        )
        return response

    async def _list_agent_member_groups(self, agent: Agent) -> list[dict[str, Any]]:
        from telethon import TelegramClient
        from telethon.sessions import StringSession
        from telethon.utils import get_peer_id

        from bot.config import get_settings

        settings = get_settings()
        if not settings.telegram_api_id or not settings.telegram_api_hash:
            return []

        sess_str = agent.session_string
        client = TelegramClient(
            StringSession(sess_str),
            settings.telegram_api_id,
            settings.telegram_api_hash,
        )
        await client.connect()
        try:
            groups: list[dict[str, Any]] = []
            async for dialog in client.iter_dialogs():
                if not (dialog.is_group or getattr(dialog.entity, "megagroup", False)):
                    continue
                tg_group_id = canonical_tg_group_id(int(get_peer_id(dialog.entity)))
                title = str(
                    getattr(dialog, "title", None)
                    or getattr(dialog.entity, "title", None)
                    or tg_group_id
                )
                groups.append({"tg_group_id": tg_group_id, "title": title})
            deduped: dict[int, dict[str, Any]] = {}
            for group in groups:
                deduped[int(group["tg_group_id"])] = group
            return list(deduped.values())
        finally:
            await client.disconnect()

    async def _ensure_agent_group_visible(self, *, agent: Agent, tg_group_id: int) -> None:
        visible_groups = await self._list_agent_member_groups(agent)
        normalized_tg_group_id = canonical_tg_group_id(int(tg_group_id))
        if not any(int(group["tg_group_id"]) == normalized_tg_group_id for group in visible_groups):
            raise ValueError("Group is not visible to this linked account")

    async def _get_scraped_group(self, tg_group_id: int) -> ScrapedGroup | None:
        return (
            await self.session.execute(
                select(ScrapedGroup).where(
                    ScrapedGroup.tg_group_id == canonical_tg_group_id(int(tg_group_id))
                )
            )
        ).scalar_one_or_none()

    async def sync_group_admins_and_bots_from_telegram(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
        tg_group_id: int,
    ) -> dict[str, int]:
        from bot.services.group_service import canonical_tg_group_id
        from bot.services.scrapers import bulk_upsert, entity_resolver, serializers

        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)
        session_string = agent.session_string
        if agent.auth_state != "active" or not session_string:
            raise ValueError("Link an active agent first")

        from bot.agents.session import SessionManager

        client = await SessionManager().get_client(agent_id)
        try:
            scraped_group = await entity_resolver.get_or_create_group_from_client(
                client=client,
                agent_id=agent_id,
                tg_group_id=tg_group_id,
                session=self.session,
            )
            try:
                entity = await entity_resolver.resolve_group_entity(
                    client, int(tg_group_id), self.session
                )
            except ValueError:
                raise ValueError(
                    "This agent account cannot access this group. "
                    "Make sure the account is a member of the group and the group is not deleted or private."
                )
            canonical_id = canonical_tg_group_id(int(tg_group_id))

            from telethon.tl.functions.channels import GetParticipantsRequest
            from telethon.tl.types import ChannelParticipantsAdmins

            admin_result = await client(
                GetParticipantsRequest(
                    channel=entity,
                    filter=ChannelParticipantsAdmins(),
                    offset=0,
                    limit=200,
                    hash=0,
                )
            )
            admin_users_by_id = {u.id: u for u in admin_result.users}
            admin_rows: list[dict] = []
            bot_rows: list[dict] = []
            admin_count = 0
            bot_count = 0

            for admin_participant in admin_result.participants:
                user_id = getattr(admin_participant, "user_id", None)
                if user_id is None:
                    continue
                admin_user = admin_users_by_id.get(user_id)
                if admin_user is None:
                    continue
                uid = int(user_id)
                row = serializers.build_member_row_from_participant(
                    admin_user,
                    scraped_group.id,
                    canonical_id,
                    uid,
                )
                role = "member"
                if hasattr(admin_participant, "creator") and admin_participant.creator:
                    role = "creator"
                elif hasattr(admin_participant, "admin_rights") and admin_participant.admin_rights:
                    role = "admin"
                row["role"] = role
                admin_rows.append(row)
                admin_count += 1
                if bool(getattr(admin_user, "bot", False)):
                    bot_count += 1

            seen_ids = {
                int(getattr(p, "user_id", 0))
                for p in admin_result.participants
                if getattr(p, "user_id", None)
            }
            async for participant in client.iter_participants(entity=entity, limit=50000):
                uid = int(getattr(participant, "id", 0) or getattr(participant, "user_id", 0))
                if uid <= 0 or uid in seen_ids:
                    continue
                seen_ids.add(uid)
                is_bot = bool(getattr(participant, "bot", False))
                if is_bot:
                    row = serializers.build_member_row_from_participant(
                        participant,
                        scraped_group.id,
                        canonical_id,
                        uid,
                    )
                    row["role"] = "member"
                    bot_rows.append(row)
                    bot_count += 1

            all_rows = admin_rows + bot_rows
            if all_rows:
                await bulk_upsert.bulk_upsert_scraped_members(
                    all_rows, self.session, scraped_by_agent_id=agent.id
                )
                await self.session.commit()

            await AgentNotificationService(self.session).create_notification(
                actor_user_id=actor_user_id,
                agent=agent,
                kind="scrape_completed",
                title="Admins & Bots synced",
                body=(
                    f"Synced {admin_count} admin{'s' if admin_count != 1 else ''} "
                    f"and {bot_count} bot{'s' if bot_count != 1 else ''} from Telegram"
                ),
                payload={
                    "tg_group_id": canonical_id,
                    "admins_count": admin_count,
                    "bots_count": bot_count,
                },
            )
            return {"admins_count": admin_count, "bots_count": bot_count}
        finally:
            await client.disconnect()

    async def fetch_and_store_target_group_members(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
        tg_group_id: int,
        limit: int = 10000,
    ) -> dict[str, Any]:
        from bot.services.group_service import canonical_tg_group_id
        from bot.services.scrapers import bulk_upsert, entity_resolver, serializers

        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)
        session_string = agent.session_string
        if agent.auth_state != "active" or not session_string:
            raise ValueError("Link an active agent first to fetch group members")

        from bot.agents.session import SessionManager

        client = await SessionManager().get_client(agent_id)
        try:
            scraped_group = await entity_resolver.get_or_create_group_from_client(
                client=client,
                agent_id=agent_id,
                tg_group_id=tg_group_id,
                session=self.session,
            )
            try:
                entity = await entity_resolver.resolve_group_entity(
                    client, int(tg_group_id), self.session
                )
            except ValueError:
                raise ValueError(
                    "This agent account cannot access this group. "
                    "Make sure the account is a member of the group and the group is not deleted or private."
                )
            canonical_id = canonical_tg_group_id(int(tg_group_id))

            member_batch: list[dict] = []
            user_ids: list[int] = []
            total_count = 0

            async for participant in client.iter_participants(entity=entity, limit=limit):
                uid = int(getattr(participant, "id", 0) or getattr(participant, "user_id", 0))
                if uid <= 0:
                    continue

                row = serializers.build_member_row_from_participant(
                    participant,
                    scraped_group.id,
                    canonical_id,
                    uid,
                )
                role = "member"
                if hasattr(participant, "creator") and participant.creator:
                    role = "creator"
                elif hasattr(participant, "admin_rights") and participant.admin_rights:
                    role = "admin"
                elif hasattr(participant, "banned_rights") and participant.banned_rights:
                    role = "restricted"
                row["role"] = role

                member_batch.append(row)
                user_ids.append(uid)
                total_count += 1

                if len(member_batch) >= 1800:
                    await bulk_upsert.bulk_upsert_scraped_members(
                        member_batch, self.session, scraped_by_agent_id=agent.id
                    )
                    member_batch = []

            if member_batch:
                await bulk_upsert.bulk_upsert_scraped_members(
                    member_batch, self.session, scraped_by_agent_id=agent.id
                )
            await self.session.commit()

            return {"user_ids": user_ids, "total": total_count}
        finally:
            await client.disconnect()

    async def _sync_users(self, members: list[dict[str, Any]]) -> None:
        user_ids = [int(member["user_id"]) for member in members]
        if not user_ids:
            return
        existing_users = (
            (await self.session.execute(select(User).where(User.tg_user_id.in_(user_ids))))
            .scalars()
            .all()
        )
        existing_by_tg_id = {int(user.tg_user_id): user for user in existing_users}
        for member in members:
            user_id = int(member["user_id"])
            existing_user = existing_by_tg_id.get(user_id)
            if existing_user is None:
                self.session.add(
                    User(
                        tg_user_id=user_id,
                        username=member["username"],
                        full_name=member["full_name"],
                    )
                )
            else:
                existing_user.username = member["username"]
                existing_user.full_name = member["full_name"]
        await self.session.commit()
