from __future__ import annotations

from typing import Any

from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.agents.contracts import AgentJobOwnership
from bot.agents.jobs import (
    GROUP_MEMBER_BROADCAST_JOB_TYPE,
    JOB_STATUS_SCHEDULED,
    normalize_group_member_broadcast_payload,
)
from bot.core.event_bus import EventBus
from bot.db.models import Agent, AgentBlacklistEntry, AgentJob, ScrapedMember, SentBroadcastMessage

from .agent_notification_service import AgentNotificationService
from .service_support import AgentServiceSupport


def _job_queued_notification(
    job_type: str, payload: dict[str, Any]
) -> tuple[str, str, dict[str, Any]]:
    if job_type == GROUP_MEMBER_BROADCAST_JOB_TYPE:
        target_type = payload.get("target_type", "members")
        if target_type == "groups":
            target_count = len(list(payload.get("target_group_ids") or []))
            summary = f"Queued for {target_count} group(s)."
            notification_payload = {
                "job_type": job_type,
                "target_type": "groups",
                "target_count": target_count,
                "job_payload": dict(payload),
            }
        else:
            group_title = str(payload.get("source_group_title") or "").strip()
            selected_count = len(list(payload.get("selected_user_ids") or []))
            summary = (
                f"Queued for {group_title}."
                if group_title
                else "Queued for the selected source group."
            )
            notification_payload = {
                "job_type": job_type,
                "target_type": "members",
                "source_group_title": group_title,
                "selected_count": selected_count,
                "job_payload": dict(payload),
            }
        return "Bulk message queued", summary, notification_payload

    return (
        "Job queued",
        f"{job_type.replace('_', ' ')} queued for this agent.",
        {"job_type": job_type, "job_payload": dict(payload)},
    )


class AgentJobService(AgentServiceSupport):
    def __init__(self, session: AsyncSession, event_bus: EventBus | None = None) -> None:
        super().__init__(session, event_bus)

    async def create_job(
        self,
        *,
        actor_user_id: int,
        agent_id: int,
        job_type: str,
        job_payload: dict[str, Any] | None = None,
        scheduled_at: datetime | None = None,
        campaign_id: int | None = None,
    ) -> AgentJob:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)
        if agent.auth_state != "active":
            raise ValueError("Agent is not authenticated")
        normalized_job_type = job_type.strip()
        if not normalized_job_type:
            raise ValueError("Job type is required")
        normalized_payload = dict(job_payload or {})
        is_broadcast = normalized_job_type == GROUP_MEMBER_BROADCAST_JOB_TYPE

        if is_broadcast:
            normalized_payload = normalize_group_member_broadcast_payload(normalized_payload)
            target_type = normalized_payload.get("target_type", "members")

            if target_type == "members":
                selected_ids = normalized_payload.get("selected_user_ids", [])
                if selected_ids:
                    exclusions = await self.compute_bulk_exclusions(
                        agent=agent,
                        source_group_id=normalized_payload.get("source_group_id", 0),
                        messages=normalized_payload["messages"],
                        selected_user_ids=selected_ids,
                        campaign_id=campaign_id,
                    )
                    normalized_payload["selected_user_ids"] = exclusions["filtered_user_ids"]
                    normalized_payload["exclusion_counts"] = {
                        k: exclusions[k]
                        for k in (
                            "total",
                            "admins_excluded",
                            "bots_excluded",
                            "already_sent_excluded",
                            "blacklisted_excluded",
                            "final_count",
                        )
                    }
                    if exclusions["final_count"] == 0:
                        raise ValueError(
                            "All recipients were excluded (admins, bots, already-sent)"
                        )
                if not scheduled_at:
                    await self._validate_broadcast_preflight(agent, normalized_payload)
            else:
                target_ids = normalized_payload.get("target_group_ids", [])
                if len(target_ids) > normalized_payload.get("threshold", 25):
                    raise ValueError(
                        f"Target groups ({len(target_ids)}) exceeds threshold ({normalized_payload.get('threshold')})"
                    )
                if not scheduled_at:
                    await self._validate_broadcast_rate_limits(agent, normalized_payload)

        status = JOB_STATUS_SCHEDULED if scheduled_at else "pending"
        job = AgentJob(
            agent_id=agent.id,
            job_type=normalized_job_type,
            job_payload=normalized_payload,
            status=status,
            scheduled_at=scheduled_at,
            campaign_id=campaign_id,
        )
        self.session.add(job)
        await self.session.commit()
        notification_title, notification_body, notification_payload = _job_queued_notification(
            normalized_job_type,
            normalized_payload,
        )
        await AgentNotificationService(self.session).create_notification(
            actor_user_id=actor_user_id,
            agent=agent,
            kind="job_queued",
            title=notification_title,
            body=notification_body,
            payload={"job_id": job.id, **notification_payload},
        )
        await self.publish(
            "agent_job_created",
            group_id=agent.group_id,
            user_id=actor_user_id,
            payload={"agent_id": agent.id, "job_id": job.id, "job_type": normalized_job_type},
        )
        return job

    async def list_jobs(
        self, *, actor_user_id: int, group_id: int, limit: int = 20
    ) -> list[AgentJob]:
        await self.ensure_group_admin(group_id, actor_user_id)
        stmt = (
            select(AgentJob)
            .join(Agent, Agent.id == AgentJob.agent_id)
            .where(Agent.group_id == group_id)
            .order_by(desc(AgentJob.created_at), desc(AgentJob.id))
            .limit(limit)
        )
        return list((await self.session.execute(stmt)).scalars())

    async def list_agent_jobs(
        self, *, actor_user_id: int, agent_id: int, limit: int = 50, job_type: str | None = None
    ) -> list[AgentJob]:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            return []
        await self.ensure_agent_owner(agent, actor_user_id)
        stmt = select(AgentJob).where(AgentJob.agent_id == agent.id)
        if job_type:
            stmt = stmt.where(AgentJob.job_type == job_type)
        stmt = stmt.order_by(desc(AgentJob.created_at), desc(AgentJob.id)).limit(limit)
        return list((await self.session.execute(stmt)).scalars())

    async def queue_automation_task_job(
        self,
        *,
        group_id: int,
        agent_id: int,
        task_key: str,
        assignment_id: str,
        task_config: dict[str, Any],
        conditions: dict[str, Any],
        event: dict[str, Any],
    ) -> AgentJobOwnership:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Assigned agent is not available")
        if agent.group_id != group_id or agent.auth_state != "active":
            raise ValueError("Assigned agent is not available")

        job = AgentJob(
            agent_id=agent.id,
            job_type="automation_task",
            job_payload={
                "task_key": task_key,
                "task_config": dict(task_config),
                "conditions": dict(conditions),
                "assignment_id": assignment_id,
                "event": dict(event),
            },
            status="pending",
        )
        self.session.add(job)
        await self.session.commit()
        await self.publish(
            "agent_job_created",
            group_id=group_id,
            user_id=None,
            payload={"agent_id": agent.id, "job_id": job.id, "job_type": job.job_type},
        )
        return AgentJobOwnership(
            job_id=job.id,
            agent_id=agent.id,
            group_id=group_id,
            job_type=job.job_type,
            status=job.status,
        )

    async def update_job_status(self, *, actor_user_id: int, job_id: int, status: str) -> AgentJob:
        job = (
            await self.session.execute(select(AgentJob).where(AgentJob.id == job_id))
        ).scalar_one_or_none()
        if job is None:
            raise ValueError("Job not found")
        agent = await self.get_agent(agent_id=job.agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)
        job.status = status.strip() or job.status
        await self.session.commit()
        return job

    async def delete_job(self, *, actor_user_id: int, job_id: int) -> bool:
        job = (
            await self.session.execute(select(AgentJob).where(AgentJob.id == job_id))
        ).scalar_one_or_none()
        if job is None:
            return False
        agent = await self.get_agent(agent_id=job.agent_id)
        if agent is None:
            return False
        await self.ensure_agent_owner(agent, actor_user_id)
        await self.session.delete(job)
        await self.session.commit()
        return True

    async def compute_bulk_exclusions(
        self,
        *,
        agent: Agent,
        source_group_id: int,
        messages: list[str],
        selected_user_ids: list[int],
        campaign_id: int | None = None,
    ) -> dict[str, Any]:
        """Compute exclusion counts and return filtered user IDs.

        Shared between the preflight endpoint and job creation.
        Always excludes admins, bots, and already-sent recipients.
        When campaign_id is present, also cross-group deduplicates
        within the same campaign.
        """
        import hashlib
        from datetime import datetime, timedelta, timezone

        total = len(selected_user_ids)
        if not selected_user_ids:
            return {
                "total": 0,
                "admins_excluded": 0,
                "bots_excluded": 0,
                "already_sent_excluded": 0,
                "blacklisted_excluded": 0,
                "final_count": 0,
                "filtered_user_ids": [],
                "message_count": len(messages),
            }

        # Fetch scraped member data for selected users
        members_data = (
            await self.session.execute(
                select(
                    ScrapedMember.tg_user_id,
                    ScrapedMember.role,
                    ScrapedMember.is_bot,
                    ScrapedMember.phone,
                    ScrapedMember.username,
                ).where(
                    ScrapedMember.tg_group_id == source_group_id,
                    ScrapedMember.tg_user_id.in_(selected_user_ids),
                )
            )
        ).all()

        member_map: dict[int, dict[str, Any]] = {}
        phones: list[str] = []
        usernames: list[str] = []
        for row in members_data:
            member_map[int(row.tg_user_id)] = {
                "role": row.role or "member",
                "is_bot": bool(row.is_bot),
                "phone": row.phone,
                "username": row.username,
            }
            if row.phone:
                normalized = row.phone.strip()
                if normalized not in phones:
                    phones.append(normalized)
            if row.username:
                normalized = row.username.strip().lower()
                if normalized not in usernames:
                    usernames.append(normalized)

        # Separate admins, bots, and others
        admins: set[int] = set()
        bots: set[int] = set()
        for uid in selected_user_ids:
            info = member_map.get(uid)
            if info is None:
                continue
            if info["role"] in ("admin", "creator"):
                admins.add(uid)
            if info["is_bot"]:
                bots.add(uid)

        # Determine already-sent from sent_broadcast_messages
        combined = "||".join(m.lower().strip() for m in messages)
        message_hash = hashlib.sha256(combined.encode()).hexdigest()
        already_sent_set: set[int] = set()
        seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
        identity_filters = [SentBroadcastMessage.tg_user_id.in_(selected_user_ids)]
        if phones:
            identity_filters.append(SentBroadcastMessage.phone_number.in_(phones))
        if usernames:
            identity_filters.append(SentBroadcastMessage.username.in_(usernames))

        group_filter = (
            or_(
                SentBroadcastMessage.tg_group_id == source_group_id,
                SentBroadcastMessage.campaign_id == campaign_id if campaign_id else False,
            )
            if campaign_id
            else SentBroadcastMessage.tg_group_id == source_group_id
        )

        sent_rows = (
            await self.session.execute(
                select(SentBroadcastMessage.tg_user_id).where(
                    SentBroadcastMessage.agent_id == agent.id,
                    group_filter,
                    SentBroadcastMessage.message_hash == message_hash,
                    SentBroadcastMessage.sent_at >= seven_days_ago,
                    SentBroadcastMessage.status == "sent",
                    or_(*identity_filters),
                )
            )
        ).all()
        for row in sent_rows:
            if row[0] is not None:
                already_sent_set.add(int(row[0]))

        # Determine blacklisted users
        blacklisted_set: set[int] = set()
        blacklist_rows = (
            await self.session.execute(
                select(AgentBlacklistEntry).where(
                    AgentBlacklistEntry.agent_id == agent.id,
                )
            )
        ).all()
        for bl_entry in blacklist_rows:
            entry = bl_entry[0] if hasattr(bl_entry, "__getitem__") else bl_entry
            if entry.tg_user_id is not None and entry.tg_user_id in selected_user_ids:
                blacklisted_set.add(int(entry.tg_user_id))
            if entry.username:
                uname = entry.username.strip().lower()
                for uid in selected_user_ids:
                    info = member_map.get(uid)
                    if info and info.get("username") and info["username"].strip().lower() == uname:
                        blacklisted_set.add(uid)
            if entry.phone:
                ph = entry.phone.strip()
                for uid in selected_user_ids:
                    info = member_map.get(uid)
                    if info and info.get("phone") and info["phone"].strip() == ph:
                        blacklisted_set.add(uid)

        # Build filtered list: exclude admins, bots, already-sent, blacklisted
        excluded: set[int] = set()
        excluded.update(admins)
        excluded.update(bots)
        excluded.update(already_sent_set)
        excluded.update(blacklisted_set)
        filtered = [uid for uid in selected_user_ids if uid not in excluded]

        return {
            "total": total,
            "admins_excluded": len(admins),
            "bots_excluded": len(bots),
            "already_sent_excluded": len(already_sent_set),
            "blacklisted_excluded": len(blacklisted_set),
            "final_count": len(filtered),
            "filtered_user_ids": filtered,
            "message_count": len(messages),
        }
    async def check_broadcast_accessibility(
        self, *, actor_user_id: int, agent_id: int, group_ids: list[int]
    ) -> dict[str, Any]:
        from bot.agents.session import SessionManager
        from bot.agents.exceptions import JobValidationError

        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)
        if agent.auth_state != "active":
            raise ValueError("Agent is not authenticated")

        session_manager = SessionManager()
        try:
            result = await session_manager.check_group_accessibility(agent.id, group_ids)
        except Exception as exc:
            raise JobValidationError(
                f"Failed to check group accessibility: {exc}",
                details={"agent_id": agent.id, "group_ids": group_ids},
            ) from exc

        if result["inaccessible"]:
            raise JobValidationError(
                f"Agent cannot access {len(result['inaccessible'])} group(s). "
                f"Ensure the agent has joined these groups before creating a broadcast.",
                details={
                    "accessible_groups": result["accessible"],
                    "inaccessible_groups": result["inaccessible"],
                },
            )

        return {
            "accessible_groups": result["accessible"],
            "inaccessible_groups": result["inaccessible"],
        }

    async def get_job_health(
        self, *, actor_user_id: int, agent_id: int
    ) -> dict[str, Any]:
        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)

        from datetime import datetime, timezone

        running_result = await self.session.execute(
            select(AgentJob).where(
                AgentJob.agent_id == agent_id,
                AgentJob.status.in_(["running", "pending", "queued"]),
            ).order_by(AgentJob.updated_at.desc())
        )
        jobs = list(running_result.scalars())

        items = []
        for job in jobs:
            payload = dict(job.job_payload or {})
            progress = payload.get("progress", {})
            sent = progress.get("success_count", 0)
            total = payload.get("total_recipients", 0) or len(payload.get("selected_user_ids", []))
            elapsed = (datetime.now(timezone.utc) - job.updated_at).total_seconds()
            last_checkpoint = progress.get("last_checkpoint_at")
            is_stuck = False
            if last_checkpoint:
                try:
                    cp_age = (
                        datetime.now(timezone.utc) - datetime.fromisoformat(last_checkpoint)
                    ).total_seconds()
                    is_stuck = cp_age > 7200
                except (ValueError, TypeError):
                    is_stuck = True

            est_remaining = None
            if sent > 0 and total > 0 and sent < total:
                per_contact = elapsed / sent
                est_remaining = (total - sent) * per_contact

            items.append({
                "job_id": job.id,
                "agent_id": agent_id,
                "job_type": job.job_type,
                "status": job.status,
                "messages_sent": sent,
                "total_recipients": total,
                "elapsed_seconds": elapsed,
                "estimated_completion_seconds": est_remaining,
                "last_checkpoint_at": last_checkpoint,
                "is_possibly_stuck": is_stuck,
                "created_at": job.created_at.isoformat() if job.created_at else None,
            })

        return {"running_jobs": items}

    async def recover_job(
        self, *, actor_user_id: int, agent_id: int, job_id: int
    ) -> dict[str, Any]:
        from bot.agents.jobs import JOB_STATUS_PENDING, JOB_STATUS_RUNNING

        agent = await self.get_agent(agent_id=agent_id)
        if agent is None:
            raise ValueError("Agent not found")
        await self.ensure_agent_owner(agent, actor_user_id)

        job = (
            await self.session.execute(
                select(AgentJob).where(
                    AgentJob.id == job_id,
                    AgentJob.agent_id == agent_id,
                )
            )
        ).scalar_one_or_none()
        if job is None:
            raise ValueError("Job not found")

        if job.status != JOB_STATUS_RUNNING:
            raise ValueError(f"Job is not running (status={job.status})")

        payload = dict(job.job_payload or {})
        progress = payload.get("progress", {})
        progress["retry_count"] = progress.get("retry_count", 0) + 1
        payload["progress"] = progress
        job.job_payload = payload
        job.status = JOB_STATUS_PENDING
        await self.session.commit()

        from bot.agents.dispatch import dispatch_agent_job
        await dispatch_agent_job(job.id)

        return {
            "job_id": job.id,
            "status": JOB_STATUS_PENDING,
            "retry_count": progress["retry_count"],
        }
    async def _validate_broadcast_preflight(self, agent: Agent, payload: dict[str, Any]) -> None:
        from bot.config import get_settings
        from bot.utils.rate_limiter import AgentRateLimiter
        from redis.asyncio import Redis

        redis_client = Redis.from_url(get_settings().redis_url, decode_responses=True)
        try:
            limiter = AgentRateLimiter(redis_client)

            cooldown_mins = getattr(agent, "cooldown_minutes", None)
            if cooldown_mins is not None and cooldown_mins > 0:
                in_cooldown, remaining = await limiter.is_in_cooldown(agent.id, cooldown_mins)
                if in_cooldown:
                    raise ValueError(f"Agent is in cooldown for {int(remaining)} more seconds")

            safety_enabled = getattr(agent, "safety_mode_enabled", True)
            safety_until = getattr(agent, "safety_mode_until", None)
            if await limiter.check_safety_mode(agent.id, safety_enabled, safety_until):
                raise ValueError("Agent is in safety mode and cannot send bulk messages")

            max_per_hour = getattr(agent, "max_actions_per_hour", None)
            if max_per_hour is not None and max_per_hour > 0:
                allowed, count = await limiter.check_and_increment(agent.id, max_per_hour)
                if not allowed:
                    raise ValueError(
                        f"Hourly rate limit reached ({count}/{max_per_hour}). Try again later."
                    )

            max_per_day = getattr(agent, "max_messages_per_day", None) or 500
            if max_per_day > 0:
                allowed, count = await limiter.check_daily_limit(agent.id, max_per_day)
                if not allowed:
                    raise ValueError(
                        f"Daily message limit reached ({count}/{max_per_day}). Try again tomorrow."
                    )

            threshold = int(payload.get("threshold") or 0)
            if threshold > max_per_day:
                raise ValueError(f"Threshold ({threshold}) exceeds daily limit ({max_per_day})")
            if threshold > 500:
                raise ValueError(f"Maximum batch size is 500. Requested: {threshold}")

        finally:
            await redis_client.aclose()

    async def _validate_broadcast_rate_limits(self, agent: Agent, payload: dict[str, Any]) -> None:
        from bot.config import get_settings
        from bot.utils.rate_limiter import AgentRateLimiter
        from redis.asyncio import Redis

        redis_client = Redis.from_url(get_settings().redis_url, decode_responses=True)
        try:
            limiter = AgentRateLimiter(redis_client)

            cooldown_mins = getattr(agent, "cooldown_minutes", None)
            if cooldown_mins is not None and cooldown_mins > 0:
                in_cooldown, remaining = await limiter.is_in_cooldown(agent.id, cooldown_mins)
                if in_cooldown:
                    raise ValueError(f"Agent is in cooldown for {int(remaining)} more seconds")

            safety_enabled = getattr(agent, "safety_mode_enabled", True)
            safety_until = getattr(agent, "safety_mode_until", None)
            if await limiter.check_safety_mode(agent.id, safety_enabled, safety_until):
                raise ValueError("Agent is in safety mode and cannot send bulk messages")

            max_per_hour = getattr(agent, "max_actions_per_hour", None)
            if max_per_hour is not None and max_per_hour > 0:
                allowed, count = await limiter.check_and_increment(agent.id, max_per_hour)
                if not allowed:
                    raise ValueError(
                        f"Hourly rate limit reached ({count}/{max_per_hour}). Try again later."
                    )

            max_per_day = getattr(agent, "max_messages_per_day", None) or 500
            if max_per_day > 0:
                allowed, count = await limiter.check_daily_limit(agent.id, max_per_day)
                if not allowed:
                    raise ValueError(
                        f"Daily message limit reached ({count}/{max_per_day}). Try again tomorrow."
                    )

            threshold = int(payload.get("threshold") or 0)
            if threshold > max_per_day:
                raise ValueError(f"Threshold ({threshold}) exceeds daily limit ({max_per_day})")
            if threshold > 500:
                raise ValueError(f"Maximum batch size is 500. Requested: {threshold}")
        finally:
            await redis_client.aclose()
