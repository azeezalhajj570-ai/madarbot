"""Blacklist service for bulk messaging exclusions."""

from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.agents.phone import normalize_optional_agent_phone_number
from bot.db.models import AgentBlacklistEntry, ScrapedMember

from .service_support import AgentServiceSupport

logger = structlog.get_logger(__name__)


class AgentBlacklistService(AgentServiceSupport):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)

    async def list_blacklist(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
        page: int = 1,
        page_size: int = 50,
    ) -> dict[str, Any]:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)

        stmt = (
            select(AgentBlacklistEntry)
            .where(AgentBlacklistEntry.agent_id == agent.id)
            .order_by(AgentBlacklistEntry.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        rows = (await self.session.execute(stmt)).scalars().all()

        total_stmt = select(AgentBlacklistEntry.id).where(AgentBlacklistEntry.agent_id == agent.id)
        total = len((await self.session.execute(total_stmt)).scalars().all())

        return {
            "entries": [
                {
                    "id": entry.id,
                    "agent_id": entry.agent_id,
                    "tg_user_id": entry.tg_user_id,
                    "username": entry.username,
                    "phone": entry.phone,
                    "reason": entry.reason,
                    "created_by": entry.created_by,
                    "created_at": entry.created_at.isoformat() if entry.created_at else None,
                }
                for entry in rows
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def add_entries(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
        entries: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)

        existing_rows = (
            await self.session.execute(
                select(AgentBlacklistEntry.tg_user_id).where(
                    AgentBlacklistEntry.agent_id == agent.id,
                    AgentBlacklistEntry.tg_user_id.isnot(None),
                )
            )
        ).scalars().all()
        existing_tg_ids: set[int] = {int(uid) for uid in existing_rows if uid is not None}

        created: list[dict[str, Any]] = []
        for entry_data in entries:
            tg_user_id = entry_data.get("tg_user_id") or None
            username = str(entry_data.get("username") or "").strip() or None
            phone_raw = entry_data.get("phone")
            phone = normalize_optional_agent_phone_number(phone_raw) if phone_raw else None
            reason = str(entry_data.get("reason") or "admin_blocked").strip()

            if tg_user_id is None and not username and not phone:
                continue

            if tg_user_id is not None and int(tg_user_id) in existing_tg_ids:
                continue

            if username:
                username = username.lstrip("@").strip().lower() or None

            blacklist_entry = AgentBlacklistEntry(
                agent_id=agent.id,
                tg_user_id=tg_user_id,
                username=username,
                phone=phone,
                reason=reason,
                created_by=actor_user_id,
            )
            self.session.add(blacklist_entry)
            await self.session.flush()
            created.append(
                {
                    "id": blacklist_entry.id,
                    "agent_id": blacklist_entry.agent_id,
                    "tg_user_id": blacklist_entry.tg_user_id,
                    "username": blacklist_entry.username,
                    "phone": blacklist_entry.phone,
                    "reason": blacklist_entry.reason,
                    "created_by": blacklist_entry.created_by,
                    "created_at": blacklist_entry.created_at.isoformat()
                    if blacklist_entry.created_at
                    else None,
                }
            )

        await self.session.commit()
        logger.info(
            "agent_blacklist_entries_added",
            agent_id=agent.id,
            count=len(created),
            skipped=len(entries) - len(created),
            actor_user_id=actor_user_id,
        )
        return created

    async def delete_entry(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
        entry_id: int,
    ) -> bool:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)

        entry = (
            await self.session.execute(
                select(AgentBlacklistEntry).where(
                    AgentBlacklistEntry.id == entry_id,
                    AgentBlacklistEntry.agent_id == agent.id,
                )
            )
        ).scalar_one_or_none()
        if entry is None:
            return False

        await self.session.delete(entry)
        await self.session.commit()
        logger.info(
            "agent_blacklist_entry_deleted",
            agent_id=agent.id,
            entry_id=entry_id,
            actor_user_id=actor_user_id,
        )
        return True

    async def resolve_phones(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
        phones: list[str],
    ) -> list[dict[str, Any]]:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)

        normalized_phones = []
        for phone in phones:
            try:
                normalized = normalize_optional_agent_phone_number(phone)
                if normalized:
                    normalized_phones.append(normalized)
            except ValueError:
                pass

        if not normalized_phones:
            return [{"phone": p, "tg_user_id": None, "resolved": False} for p in phones]

        rows = (
            await self.session.execute(
                select(ScrapedMember.tg_user_id, ScrapedMember.phone)
                .where(
                    ScrapedMember.phone.in_(normalized_phones),
                    ScrapedMember.tg_user_id.is_not(None),
                )
                .distinct()
            )
        ).all()

        phone_to_user: dict[str, int] = {}
        for row in rows:
            if row.phone and row.tg_user_id:
                phone_to_user[row.phone.strip()] = int(row.tg_user_id)

        results = []
        for phone in phones:
            try:
                normalized = normalize_optional_agent_phone_number(phone)
                user_id = phone_to_user.get(normalized) if normalized else None
                results.append(
                    {
                        "phone": phone,
                        "tg_user_id": user_id,
                        "resolved": user_id is not None,
                    }
                )
            except ValueError:
                results.append({"phone": phone, "tg_user_id": None, "resolved": False})

        return results
