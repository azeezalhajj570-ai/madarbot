from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.core.event_bus import Event, EventBus
from bot.db.models import Agent
from bot.services.permission_service import PermissionService


class AgentServiceSupport:
    def __init__(self, session: AsyncSession, event_bus: EventBus | None = None) -> None:
        self.session = session
        self.event_bus = event_bus

    async def ensure_group_admin(self, group_id: int, actor_user_id: int) -> None:
        from bot.config import get_settings

        if actor_user_id in get_settings().bot_owner_ids:
            return
        can_manage = await PermissionService(self.session).can(
            group_id, actor_user_id, "group.settings.update"
        )
        if not can_manage:
            raise PermissionError("User does not have permission to manage agents for this group")

    async def resolve_actor_tenant_id(self, actor_user_id: int) -> int:
        """Resolve the tenant (workspace) a raw tg_user_id acts on behalf of.

        `actor_user_id` throughout bot.agents is a raw Telegram user id.
        Auto-creates a single-member workspace on first use, same as the
        dashboard's `get_workspace_context`. See specs/015-workspace-mvp.
        """
        from bot.services.user_service import UserService
        from bot.services.workspace_service import WorkspaceService

        user = await UserService(self.session).get_or_create_user_by_tg_id(actor_user_id)
        tenant = await WorkspaceService(self.session).get_or_create_user_workspace(user.id)
        return tenant.id

    async def ensure_agent_owner(self, agent: Agent, actor_user_id: int) -> None:
        from bot.config import get_settings

        if actor_user_id in get_settings().bot_owner_ids:
            return

        if agent.tenant_id is not None:
            from bot.services.user_service import UserService
            from bot.services.workspace_service import WorkspaceService

            user = await UserService(self.session).get_by_tg_id(actor_user_id)
            membership = (
                await WorkspaceService(self.session).get_membership(
                    tenant_id=agent.tenant_id, user_id=user.id
                )
                if user is not None
                else None
            )
            if membership is None:
                raise PermissionError("You do not have access to this agent's workspace")
            return

        # Agent predates the tenant_id backfill (or backfill hasn't run yet) —
        # fall back to the legacy single-owner check.
        if agent.linked_by_user_id is not None and int(agent.linked_by_user_id) != int(
            actor_user_id
        ):
            raise PermissionError("You do not own this agent")

    async def publish(
        self, name: str, *, group_id: int, user_id: int, payload: dict[str, Any]
    ) -> None:
        if self.event_bus is None:
            return
        await self.event_bus.publish(
            Event(name=name, group_id=group_id, user_id=user_id, payload=payload)
        )

    async def get_agent(self, *, agent_id: int) -> Agent | None:
        return (
            await self.session.execute(select(Agent).where(Agent.id == agent_id))
        ).scalar_one_or_none()
