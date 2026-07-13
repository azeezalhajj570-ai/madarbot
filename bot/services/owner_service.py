from __future__ import annotations

from typing import Any

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.models import (
    Agent,
    AgentJob,
    Group,
    GroupAdminRole,
    GroupSetting,
    ModerationLog,
    User,
    Warning,
    SentBroadcastMessage,
)
from bot.services.settings_service import SettingsService


class OwnerService:
    def __init__(self, session: AsyncSession, user_tg_id: int | None = None) -> None:
        self.session = session
        self.user_tg_id = user_tg_id

    async def _owned_group_ids(self) -> set[int]:
        if self.user_tg_id is None:
            return set()
        rows = (
            await self.session.execute(
                select(Group.id)
                .join(User, Group.owner_user_id == User.id)
                .where(User.tg_user_id == self.user_tg_id)
            )
        ).all()
        return {row[0] for row in rows}

    async def list_groups(self) -> list[dict[str, Any]]:
        admin_count_sq = (
            select(func.count(GroupAdminRole.id))
            .where(GroupAdminRole.group_id == Group.id)
            .correlate(Group)
            .scalar_subquery()
        )
        warning_count_sq = (
            select(func.coalesce(func.sum(Warning.count), 0))
            .where(Warning.group_id == Group.id)
            .correlate(Group)
            .scalar_subquery()
        )
        plugin_count_sq = (
            select(func.count(PluginEnabled.id))
            .where(PluginEnabled.group_id == Group.id, PluginEnabled.enabled.is_(True))
            .correlate(Group)
            .scalar_subquery()
        )
        agent_count_sq = (
            select(func.count(Agent.id))
            .where(Agent.group_id == Group.id)
            .correlate(Group)
            .scalar_subquery()
        )
        last_activity_sq = (
            select(func.max(ModerationLog.created_at))
            .where(ModerationLog.group_id == Group.id)
            .correlate(Group)
            .scalar_subquery()
        )

        owned_ids = await self._owned_group_ids()
        base = (
            select(
                Group.id,
                Group.title,
                Group.tg_group_id,
                Group.is_active,
                Group.created_at,
                admin_count_sq.label("admin_count"),
                warning_count_sq.label("warning_count"),
                plugin_count_sq.label("plugin_count"),
                agent_count_sq.label("agent_count"),
                last_activity_sq.label("last_activity_at"),
            )
        ).order_by(Group.is_active.desc(), Group.title.asc(), Group.id.asc())
        if owned_ids:
            base = base.where(Group.id.in_(owned_ids))
        rows = (await self.session.execute(base)).all()

        return [
            {
                "id": row.id,
                "title": row.title,
                "tg_group_id": row.tg_group_id,
                "is_active": bool(row.is_active),
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "admin_count": int(row.admin_count or 0),
                "warning_count": int(row.warning_count or 0),
                "plugin_count": int(row.plugin_count or 0),
                "agent_count": int(row.agent_count or 0),
                "last_activity_at": row.last_activity_at.isoformat()
                if row.last_activity_at
                else None,
            }
            for row in rows
        ]

    async def get_group_details(self, group_id: int) -> dict[str, Any] | None:
        owned_ids = await self._owned_group_ids()
        if owned_ids and group_id not in owned_ids:
            return None
        group = (
            await self.session.execute(select(Group).where(Group.id == group_id))
        ).scalar_one_or_none()
        if group is None:
            return None

        admins = (
            await self.session.execute(
                select(GroupAdminRole.user_id, GroupAdminRole.role, GroupAdminRole.created_at)
                .where(GroupAdminRole.group_id == group_id)
                .order_by(GroupAdminRole.created_at.asc(), GroupAdminRole.id.asc())
            )
        ).all()
        settings = (
            await self.session.execute(
                select(GroupSetting.key, GroupSetting.value, GroupSetting.updated_at)
                .where(GroupSetting.group_id == group_id)
                .order_by(GroupSetting.key.asc())
            )
        ).all()
        plugins = (
            await self.session.execute(
                select(PluginEnabled.plugin_name, PluginEnabled.enabled, PluginEnabled.config)
                .where(PluginEnabled.group_id == group_id)
                .order_by(PluginEnabled.plugin_name.asc())
            )
        ).all()
        warnings = (
            await self.session.execute(
                select(Warning.user_id, Warning.count, Warning.reason, Warning.created_at)
                .where(Warning.group_id == group_id)
                .order_by(desc(Warning.created_at), desc(Warning.id))
                .limit(25)
            )
        ).all()
        logs = (
            await self.session.execute(
                select(
                    ModerationLog.action,
                    ModerationLog.target_user_id,
                    ModerationLog.admin_user_id,
                    ModerationLog.reason,
                    ModerationLog.details,
                    ModerationLog.created_at,
                )
                .where(ModerationLog.group_id == group_id)
                .order_by(desc(ModerationLog.created_at), desc(ModerationLog.id))
                .limit(25)
            )
        ).all()
        agents = (
            await self.session.execute(
                select(
                    Agent.id,
                    Agent.external_account_id,
                    Agent.telegram_user_id,
                    Agent.status,
                    Agent.auth_state,
                    Agent.updated_at,
                )
                .where(Agent.group_id == group_id)
                .order_by(Agent.id.asc())
            )
        ).all()

        return {
            "group": {
                "id": group.id,
                "title": group.title,
                "tg_group_id": group.tg_group_id,
                "is_active": bool(group.is_active),
                "created_at": group.created_at.isoformat() if group.created_at else None,
            },
            "admins": [
                {
                    "user_id": row.user_id,
                    "role": row.role,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in admins
            ],
            "settings": [
                {
                    "key": row.key,
                    "value": SettingsService.unwrap_value(row.value),
                    "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                }
                for row in settings
            ],
            "plugins": [
                {
                    "plugin_name": row.plugin_name,
                    "enabled": bool(row.enabled),
                    "config": row.config or {},
                }
                for row in plugins
            ],
            "warnings": [
                {
                    "user_id": row.user_id,
                    "count": row.count,
                    "reason": row.reason,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in warnings
            ],
            "recent_logs": [
                {
                    "action": row.action,
                    "target_user_id": row.target_user_id,
                    "admin_user_id": row.admin_user_id,
                    "reason": row.reason,
                    "details": row.details or {},
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in logs
            ],
            "agents": [
                {
                    "id": row.id,
                    "external_account_id": row.external_account_id,
                    "telegram_user_id": row.telegram_user_id,
                    "status": row.status,
                    "auth_state": row.auth_state,
                    "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                }
                for row in agents
            ],
        }

    async def stats(self) -> dict[str, int]:
        from datetime import datetime, timedelta, timezone

        owned_ids = await self._owned_group_ids()
        if not owned_ids:
            return {
                "total_groups": 0, "active_groups": 0, "tracked_admins": 0, "moderation_actions": 0,
                "open_warnings": 0, "enabled_plugins": 0, "linked_agents": 0, "pending_agent_jobs": 0,
                "jobs_by_status": {}, "total_jobs": 0, "stuck_jobs": 0, "failure_rate_24h": 0.0,
                "messages_sent_24h": 0, "active_agents": 0,
            }

        total_groups = (await self.session.execute(select(func.count(Group.id)).where(Group.id.in_(owned_ids)))).scalar_one()
        active_groups = (
            await self.session.execute(
                select(func.count(Group.id)).where(Group.is_active.is_(True), Group.id.in_(owned_ids))
            )
        ).scalar_one()
        total_users = (
            await self.session.execute(
                select(func.count(func.distinct(GroupAdminRole.user_id)))
                .where(GroupAdminRole.group_id.in_(owned_ids))
            )
        ).scalar_one()
        moderation_actions = (
            await self.session.execute(
                select(func.count(ModerationLog.id))
                .where(ModerationLog.group_id.in_(owned_ids))
            )
        ).scalar_one()
        open_warnings = (
            await self.session.execute(
                select(func.coalesce(func.sum(Warning.count), 0))
                .where(Warning.group_id.in_(owned_ids))
            )
        ).scalar_one()
        linked_agents_sq = (
            select(func.count(Agent.id))
            .where(Agent.group_id.in_(owned_ids))
        )
        linked_agents = (await self.session.execute(linked_agents_sq)).scalar_one()
        active_agents_sq = (
            select(func.count(Agent.id))
            .where(Agent.status == "active", Agent.group_id.in_(owned_ids))
        )
        active_agents = (await self.session.execute(active_agents_sq)).scalar_one()

        # Jobs - scope via agent -> group
        agent_id_sq = select(Agent.id).where(Agent.group_id.in_(owned_ids))
        pending_agent_jobs = (
            await self.session.execute(
                select(func.count(AgentJob.id)).where(
                    AgentJob.status.in_(("pending", "queued", "running")),
                    AgentJob.agent_id.in_(agent_id_sq),
                )
            )
        ).scalar_one()
        status_counts = (
            await self.session.execute(
                select(AgentJob.status, func.count(AgentJob.id))
                .where(AgentJob.agent_id.in_(agent_id_sq))
                .group_by(AgentJob.status)
            )
        ).all()
        jobs_by_status = {row.status: int(row[1]) for row in status_counts}
        total_jobs = sum(jobs_by_status.values()) if jobs_by_status else 0

        threshold_hours = 2
        stuck_cutoff = datetime.now(timezone.utc) - timedelta(hours=threshold_hours)
        stuck = (
            await self.session.execute(
                select(func.count(AgentJob.id)).where(
                    AgentJob.status == "running",
                    AgentJob.updated_at < stuck_cutoff,
                    AgentJob.agent_id.in_(agent_id_sq),
                )
            )
        ).scalar_one()

        cutoff_24h = datetime.now(timezone.utc) - timedelta(hours=24)
        failed_24h = (
            await self.session.execute(
                select(func.count(AgentJob.id)).where(
                    AgentJob.status == "failed",
                    AgentJob.updated_at > cutoff_24h,
                    AgentJob.agent_id.in_(agent_id_sq),
                )
            )
        ).scalar_one()
        completed_24h = (
            await self.session.execute(
                select(func.count(AgentJob.id)).where(
                    AgentJob.status == "completed",
                    AgentJob.updated_at > cutoff_24h,
                    AgentJob.agent_id.in_(agent_id_sq),
                )
            )
        ).scalar_one()
        total_24h = int(failed_24h or 0) + int(completed_24h or 0)
        failure_rate = round(int(failed_24h or 0) / total_24h, 4) if total_24h > 0 else 0.0

        msgs_24h = (
            await self.session.execute(
                select(func.count(SentBroadcastMessage.id))
                .where(
                    SentBroadcastMessage.sent_at > cutoff_24h,
                    SentBroadcastMessage.agent_id.in_(agent_id_sq),
                )
            )
        ).scalar_one()

        return {
            "total_groups": int(total_groups or 0),
            "active_groups": int(active_groups or 0),
            "tracked_admins": int(total_users or 0),
            "moderation_actions": int(moderation_actions or 0),
            "open_warnings": int(open_warnings or 0),
            "linked_agents": int(linked_agents or 0),
            "pending_agent_jobs": int(pending_agent_jobs or 0),
            "jobs_by_status": jobs_by_status,
            "total_jobs": total_jobs,
            "stuck_jobs": int(stuck or 0),
            "failure_rate_24h": failure_rate,
            "messages_sent_24h": int(msgs_24h or 0),
            "active_agents": int(active_agents or 0),
        }

    async def disable_group(self, group_id: int) -> dict[str, Any] | None:
        owned_ids = await self._owned_group_ids()
        if owned_ids and group_id not in owned_ids:
            return None
        group = (
            await self.session.execute(select(Group).where(Group.id == group_id))
        ).scalar_one_or_none()
        if group is None:
            return None
        group.is_active = False
        await self.session.commit()
        return {
            "id": group.id,
            "title": group.title,
            "tg_group_id": group.tg_group_id,
            "is_active": bool(group.is_active),
        }

    async def list_all_agents(self, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        owned_ids = await self._owned_group_ids()
        stmt = (
            select(
                Agent.id,
                Agent.external_account_id,
                Agent.telegram_user_id,
                Agent.phone_number,
                Agent.status,
                Agent.auth_state,
                Agent.created_at,
                Agent.updated_at,
                Group.title.label("group_title"),
                Group.id.label("group_id"),
            )
            .join(Group, Agent.group_id == Group.id)
            .order_by(Agent.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        if owned_ids:
            stmt = stmt.where(Group.id.in_(owned_ids))
        rows = (await self.session.execute(stmt)).all()
        return [
            {
                "id": row.id,
                "external_account_id": row.external_account_id,
                "telegram_user_id": row.telegram_user_id,
                "phone_number": row.phone_number,
                "status": row.status,
                "auth_state": row.auth_state,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                "group_title": row.group_title,
                "group_id": row.group_id,
            }
            for row in rows
        ]
