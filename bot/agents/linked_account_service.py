from __future__ import annotations

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.agents.contracts import LinkedAccountIdentity
from bot.core.event_bus import EventBus
from bot.db.models import Agent

from .phone import normalize_optional_agent_phone_number
from .service_support import AgentServiceSupport


class LinkedAccountService(AgentServiceSupport):
    def __init__(self, session: AsyncSession, event_bus: EventBus | None = None) -> None:
        super().__init__(session, event_bus)

    async def ensure_self_agent(
        self,
        *,
        actor_user_id: int,
        telegram_user_id: int | None = None,
        phone_number: str | None = None,
        username: str | None = None,
        display_name: str | None = None,
    ) -> Agent | None:
        """Idempotently register the logged-in user's own Telegram account as
        an agent so it can be activated and used for bulk operations from the
        dashboard. Skipped when the user already has an agent row (their
        account was linked before); returns that existing agent if it matches
        the identity, otherwise None.
        """
        existing = (
            (
                await self.session.execute(
                    select(Agent).where(Agent.linked_by_user_id == actor_user_id)
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            changed = False
            if existing.telegram_user_id is None and telegram_user_id:
                existing.telegram_user_id = telegram_user_id
                changed = True
            if not existing.phone_number and phone_number:
                try:
                    existing.phone_number = normalize_optional_agent_phone_number(phone_number)
                    changed = True
                except ValueError:
                    pass
            if changed:
                await self.session.commit()
            return existing

        normalized_phone: str | None = None
        if phone_number:
            try:
                candidate_phone = normalize_optional_agent_phone_number(phone_number)
            except ValueError:
                candidate_phone = None
            if candidate_phone:
                phone_taken = (
                    (
                        await self.session.execute(
                            select(Agent).where(Agent.phone_number == candidate_phone)
                        )
                    )
                    .scalars()
                    .first()
                )
                if phone_taken is None:
                    normalized_phone = candidate_phone

        tenant_id = await self.resolve_actor_tenant_id(actor_user_id)
        account_id = str(username or "").strip() or f"tg_{telegram_user_id or actor_user_id}"
        agent = Agent(
            telegram_user_id=telegram_user_id or actor_user_id,
            linked_by_user_id=actor_user_id,
            tenant_id=tenant_id,
            phone_number=normalized_phone,
            external_account_id=account_id,
            status="pending",
            auth_state="pending_auth",
            details={
                "display_name": str(display_name or "").strip() or "My Telegram account",
                "source": "browser_login",
                "is_self": True,
            },
        )
        self.session.add(agent)
        await self.session.commit()
        await self.publish(
            "agent_linked",
            group_id=0,
            user_id=actor_user_id,
            payload={"agent_id": agent.id, "external_account_id": account_id},
        )
        return agent

    async def create_agent(
        self,
        *,
        actor_user_id: int,
        group_id: int | None,
        external_account_id: str | None = None,
        phone_number: str | None = None,
        telegram_user_id: int | None = None,
        metadata: dict | None = None,
    ) -> Agent:
        normalized_account_id = str(external_account_id or "").strip()
        if not normalized_account_id:
            raise ValueError("Agent account identifier is required")
        normalized_phone_number = normalize_optional_agent_phone_number(phone_number)
        tenant_id = await self.resolve_actor_tenant_id(actor_user_id)

        existing = (
            (
                await self.session.execute(
                    select(Agent).where(
                        Agent.linked_by_user_id == actor_user_id,
                        Agent.external_account_id == normalized_account_id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if existing:
            if existing.auth_state in {"pending_auth", "pending_code", "pending_2fa", "failed"}:
                existing.phone_number = normalized_phone_number or existing.phone_number
                existing.auth_state = "pending_auth"
                existing.status = "pending"
                await self.session.commit()
                return existing
            raise ValueError("Agent account is already linked")
        if normalized_phone_number:
            existing_phone = (
                (
                    await self.session.execute(
                        select(Agent).where(
                            Agent.phone_number == normalized_phone_number,
                            Agent.linked_by_user_id == actor_user_id,
                        )
                    )
                )
                .scalars()
                .first()
            )
            if existing_phone:
                raise ValueError("Phone number is already linked for this subscription")

        agent = Agent(
            telegram_user_id=telegram_user_id,
            linked_by_user_id=actor_user_id,
            tenant_id=tenant_id,
            group_id=group_id,
            phone_number=normalized_phone_number,
            external_account_id=normalized_account_id,
            status="pending",
            auth_state="pending_auth",
            details=dict(metadata or {}),
        )
        self.session.add(agent)
        await self.session.commit()
        await self.publish(
            "agent_linked",
            group_id=group_id or 0,
            user_id=actor_user_id,
            payload={"agent_id": agent.id, "external_account_id": normalized_account_id},
        )
        return agent

    async def update_agent(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
        external_account_id: str | None = None,
        phone_number: str | None = None,
        telegram_user_id: int | None = None,
        metadata: dict | None = None,
    ) -> Agent:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)

        normalized_account_id = str(external_account_id or "").strip()
        if not normalized_account_id:
            raise ValueError("Agent account identifier is required")
        normalized_phone_number = normalize_optional_agent_phone_number(phone_number)

        existing = (
            (
                await self.session.execute(
                    select(Agent).where(
                        Agent.group_id == agent.group_id,
                        Agent.external_account_id == normalized_account_id,
                        Agent.id != agent.id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if existing:
            raise ValueError("Agent account is already linked for this group")
        if normalized_phone_number:
            existing_phone = (
                (
                    await self.session.execute(
                        select(Agent).where(
                            Agent.phone_number == normalized_phone_number,
                            Agent.id != agent.id,
                            or_(
                                Agent.group_id == agent.group_id,
                                Agent.linked_by_user_id == actor_user_id,
                            ),
                        )
                    )
                )
                .scalars()
                .first()
            )
            if existing_phone:
                raise ValueError("Phone number is already linked for this subscription")

        agent.external_account_id = normalized_account_id
        agent.phone_number = normalized_phone_number
        agent.telegram_user_id = telegram_user_id
        agent.linked_by_user_id = agent.linked_by_user_id or actor_user_id
        agent.details = dict(metadata or {})
        await self.session.commit()
        await self.publish(
            "agent_updated",
            group_id=agent.group_id,
            user_id=actor_user_id,
            payload={"agent_id": agent.id, "external_account_id": normalized_account_id},
        )
        return agent

    async def unlink_agent(self, *, actor_user_id: int, agent_id: int) -> bool:
        from bot.db.models.bulk_messaging import AgentBlacklistEntry

        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            return False
        await self.ensure_agent_owner(agent, actor_user_id)
        group_id = agent.group_id
        external_account_id = agent.external_account_id

        bl_entries = (
            (
                await self.session.execute(
                    select(AgentBlacklistEntry).where(AgentBlacklistEntry.agent_id == agent_id)
                )
            )
            .scalars()
            .all()
        )
        for entry in bl_entries:
            await self.session.delete(entry)

        await self.session.delete(agent)
        await self.session.commit()
        await self.publish(
            "agent_unlinked",
            group_id=group_id,
            user_id=actor_user_id,
            payload={"agent_id": agent_id, "external_account_id": external_account_id},
        )
        return True

    async def list_agents(self, *, actor_user_id: int, group_id: int | None = None) -> list[Agent]:
        tenant_id = await self.resolve_actor_tenant_id(actor_user_id)
        # Workspace members share visibility of all agents in the tenant (US2).
        # The linked_by_user_id fallback covers agents from before the
        # tenant_id backfill ran — should be empty once the migration completes.
        stmt = (
            select(Agent)
            .where(
                or_(
                    Agent.tenant_id == tenant_id,
                    and_(Agent.tenant_id.is_(None), Agent.linked_by_user_id == actor_user_id),
                )
            )
            .order_by(Agent.created_at.desc(), Agent.id.desc())
        )
        if group_id is not None:
            stmt = stmt.where(or_(Agent.group_id == group_id, Agent.group_id.is_(None)))
        return list((await self.session.execute(stmt)).scalars())

    async def list_all_active_agents(self, *, actor_user_id: int) -> list[Agent]:
        agents = await self.list_agents(actor_user_id=actor_user_id)
        return [a for a in agents if a.auth_state == "active"]

    async def get_agent_by_external_account(
        self,
        *,
        actor_user_id: int,
        group_id: int,
        external_account_id: str,
    ) -> Agent | None:
        await self.ensure_group_admin(group_id, actor_user_id)
        normalized_account_id = external_account_id.strip()
        if not normalized_account_id:
            return None
        return (
            await self.session.execute(
                select(Agent).where(
                    Agent.group_id == group_id,
                    Agent.external_account_id == normalized_account_id,
                )
            )
        ).scalar_one_or_none()

    async def describe_linked_account(self, *, agent_id: int) -> LinkedAccountIdentity | None:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            return None
        return self._to_identity(agent)

    async def list_linked_account_identities(
        self, *, actor_user_id: int, group_id: int
    ) -> list[LinkedAccountIdentity]:
        agents = await self.list_agents(actor_user_id=actor_user_id, group_id=group_id)
        return [self._to_identity(agent) for agent in agents]

    @staticmethod
    def _to_identity(agent: Agent) -> LinkedAccountIdentity:
        return LinkedAccountIdentity(
            agent_id=agent.id,
            group_id=agent.group_id,
            external_account_id=str(agent.external_account_id or ""),
            telegram_user_id=agent.telegram_user_id,
        )
