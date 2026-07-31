from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from bot.db.models import (
    Agent,
    Group,
    Plan,
    PlanFeature,
    Subscription,
    SubscriptionRequest,
    SubscriptionStatus,
)


def build_owner_notification(
    request_id: int,
    actor_label: str,
    actor_id: int,
    message_text: str | None,
    review_url: str | None,
) -> str:
    lines = [
        f"Subscription request #{request_id}",
        f"From: {actor_label} (TG {actor_id})",
        f"Message: {message_text or 'No message provided.'}",
    ]
    if review_url:
        lines.append(f"Review: {review_url}")
    return "\n".join(lines)


def build_requester_status_notification(
    *,
    status: SubscriptionStatus,
    response: str | None,
) -> str:
    if status is SubscriptionStatus.APPROVED:
        lines = ["Your subscription request was approved."]
    elif status is SubscriptionStatus.DECLINED:
        lines = ["Your subscription request was declined."]
    elif status is SubscriptionStatus.CANCELLED:
        lines = ["Your subscription was cancelled."]
    elif status is SubscriptionStatus.SUPERSEDED:
        lines = ["Your earlier subscription approval was replaced by a newer request."]
    else:
        lines = [f"Your subscription request status was updated to {status.value}."]
    if response:
        lines.append(f"Note: {response}")
    return "\n".join(lines)


class SubscriptionService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def has_active_subscription(
        self, *, tg_user_id: int, bot_kind: str | None = None
    ) -> bool:
        sub = await self.get_active_subscription(tg_user_id=tg_user_id, bot_kind=bot_kind)
        return sub is not None

    async def get_active_subscription(
        self, *, tg_user_id: int, bot_kind: str | None = None
    ) -> SubscriptionRequest | None:
        now = datetime.now(timezone.utc)
        stmt = (
            select(SubscriptionRequest)
            .where(
                SubscriptionRequest.tg_user_id == tg_user_id,
                SubscriptionRequest.status == SubscriptionStatus.APPROVED.value,
                or_(
                    SubscriptionRequest.expires_at.is_(None),
                    SubscriptionRequest.expires_at > now,
                ),
            )
            .order_by(desc(SubscriptionRequest.id))
            .limit(1)
        )
        if bot_kind:
            stmt = stmt.where(
                or_(
                    SubscriptionRequest.bot_kind == bot_kind,
                    SubscriptionRequest.bot_kind.is_(None),
                )
            )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def ensure_free_plan(
        self,
        *,
        tg_user_id: int,
        username: str | None,
        full_name: str | None,
        language_code: str | None,
        bot_kind: str | None = None,
    ) -> SubscriptionRequest:
        existing = await self.get_active_subscription(tg_user_id=tg_user_id, bot_kind=bot_kind)
        if existing is not None:
            return existing

        request = SubscriptionRequest(
            tg_user_id=tg_user_id,
            username=username,
            full_name=full_name,
            language_code=language_code,
            status=SubscriptionStatus.APPROVED.value,
            plan="free",
            bot_kind=bot_kind,
        )
        self.session.add(request)
        await self.session.flush()
        await self.session.commit()
        await self.session.refresh(request)
        return request

    async def create_request(
        self,
        *,
        tg_user_id: int,
        username: str | None,
        full_name: str | None,
        language_code: str | None,
        message: str | None,
    ) -> SubscriptionRequest:
        request = SubscriptionRequest(
            tg_user_id=tg_user_id,
            username=username,
            full_name=full_name,
            language_code=language_code,
            message=message,
            status=SubscriptionStatus.PENDING.value,
        )
        self.session.add(request)
        await self.session.flush()
        await self.session.commit()
        await self.session.refresh(request)
        return request

    async def list_requests(self) -> list[SubscriptionRequest]:
        rows = (
            (
                await self.session.execute(
                    select(SubscriptionRequest).order_by(desc(SubscriptionRequest.created_at))
                )
            )
            .scalars()
            .all()
        )
        return rows

    async def get_latest_request(self, *, tg_user_id: int) -> SubscriptionRequest | None:
        return (
            await self.session.execute(
                select(SubscriptionRequest)
                .where(SubscriptionRequest.tg_user_id == tg_user_id)
                .order_by(desc(SubscriptionRequest.created_at), desc(SubscriptionRequest.id))
                .limit(1)
            )
        ).scalar_one_or_none()

    async def get_request(self, request_id: int) -> SubscriptionRequest | None:
        return (
            await self.session.execute(
                select(SubscriptionRequest).where(SubscriptionRequest.id == request_id)
            )
        ).scalar_one_or_none()

    async def set_user_plan(
        self,
        *,
        tg_user_id: int,
        plan: str,
        username: str | None = None,
        full_name: str | None = None,
        language_code: str | None = None,
        expires_at: datetime | None = None,
        responder_id: int | None = None,
        message: str | None = None,
        bot_kind: str | None = None,
    ) -> SubscriptionRequest:
        existing = await self.get_active_subscription(tg_user_id=tg_user_id, bot_kind=bot_kind)
        if existing is not None and existing.plan == plan and existing.expires_at == expires_at:
            return existing

        supersede_note = "Superseded by a newer plan assignment."
        if existing is not None:
            existing.status = SubscriptionStatus.SUPERSEDED.value
            existing.response = existing.response or supersede_note
            existing.response_by = responder_id
            await self.session.flush()

        request = SubscriptionRequest(
            tg_user_id=tg_user_id,
            username=username,
            full_name=full_name,
            language_code=language_code,
            message=message or f"Plan set to {plan} by admin",
            status=SubscriptionStatus.APPROVED.value,
            plan=plan,
            expires_at=expires_at,
            response_by=responder_id,
            bot_kind=bot_kind,
        )
        self.session.add(request)
        await self.session.flush()
        await self.session.commit()
        await self.session.refresh(request)
        return request

    async def list_active_subscriptions(
        self, bot_kind: str | None = None
    ) -> list[SubscriptionRequest]:
        now = datetime.now(timezone.utc)
        stmt = (
            select(SubscriptionRequest)
            .where(
                SubscriptionRequest.status == SubscriptionStatus.APPROVED.value,
                or_(
                    SubscriptionRequest.expires_at.is_(None),
                    SubscriptionRequest.expires_at > now,
                ),
            )
            .order_by(desc(SubscriptionRequest.id))
        )
        if bot_kind:
            stmt = stmt.where(SubscriptionRequest.bot_kind == bot_kind)
        return (await self.session.execute(stmt)).scalars().all()

    async def update_request_status(
        self,
        *,
        request_id: int,
        status: SubscriptionStatus,
        response: str | None,
        responder_id: int | None,
    ) -> SubscriptionRequest | None:
        request = await self.get_request(request_id)
        if request is None:
            return None
        if status is SubscriptionStatus.APPROVED:
            supersede_note = "Superseded by a newer approved request."
            supersede_stmt = select(SubscriptionRequest).where(
                SubscriptionRequest.tg_user_id == request.tg_user_id,
                SubscriptionRequest.status == SubscriptionStatus.APPROVED.value,
                SubscriptionRequest.id != request_id,
            )
            if request.bot_kind:
                supersede_stmt = supersede_stmt.where(
                    or_(
                        SubscriptionRequest.bot_kind == request.bot_kind,
                        SubscriptionRequest.bot_kind.is_(None),
                    )
                )
            other_approved = (await self.session.execute(supersede_stmt)).scalars().all()
            for row in other_approved:
                row.status = SubscriptionStatus.SUPERSEDED.value
                row.response = row.response or supersede_note
                row.response_by = responder_id
            if other_approved:
                await self.session.flush()
        request.status = status.value
        request.response = response
        request.response_by = responder_id
        await self.session.commit()
        await self.session.refresh(request)
        return request

    async def cancel_subscription(
        self, *, tg_user_id: int, responder_id: int | None = None, bot_kind: str | None = None
    ) -> bool:
        active = await self.get_active_subscription(tg_user_id=tg_user_id, bot_kind=bot_kind)
        if active is None:
            return False
        active.status = SubscriptionStatus.CANCELLED.value
        active.response = "Cancelled by admin"
        active.response_by = responder_id
        await self.session.commit()
        return True

    # ─── Tenant-scoped (workspace) usage — see specs/015-workspace-mvp ────────

    async def get_active_subscription_for_tenant(self, tenant_id: int) -> Subscription | None:
        return (
            await self.session.execute(
                select(Subscription).where(
                    Subscription.tenant_id == tenant_id,
                    Subscription.status == "active",
                )
            )
        ).scalar_one_or_none()

    async def get_workspace_usage(self, *, tenant_id: int, tg_user_id: int) -> dict:
        """Plan + resource usage for a workspace's dashboard usage page.

        Prefers the tenant-scoped Subscription (bot/db/models/billing.py)
        when one exists. Nothing populates those yet in practice, so this
        falls back to the legacy per-user SubscriptionRequest for the plan
        label — resource counts (agents/groups) are always real, queried
        directly from the tenant_id-scoped tables, regardless of which
        subscription source is used.
        """
        from bot.config import get_settings
        settings = get_settings()

        subscription = await self.get_active_subscription_for_tenant(tenant_id)
        plan_features: dict[str, PlanFeature] = {}
        plan_label: str | None = None
        plan_slug: str | None = None
        status_value: str | None = None
        expires_at: str | None = None
        source = "none"

        if tg_user_id in settings.bot_owner_ids:
            plan_label = "Owner"
            plan_slug = "owner"
            status_value = "active"
            source = "owner"
        elif subscription is not None:
            plan = (
                await self.session.execute(select(Plan).where(Plan.id == subscription.plan_id))
            ).scalar_one_or_none()
            if plan is not None:
                plan_label = plan.name
                plan_slug = plan.slug
                if subscription.current_period_end:
                    expires_at = subscription.current_period_end.isoformat()
                rows = (
                    (
                        await self.session.execute(
                            select(PlanFeature).where(PlanFeature.plan_id == plan.id)
                        )
                    )
                    .scalars()
                    .all()
                )
                plan_features = {row.feature_key: row for row in rows}
            status_value = subscription.status
            source = "workspace"
        else:
            legacy = await self.get_active_subscription(tg_user_id=tg_user_id)
            if legacy is not None:
                plan_label = legacy.plan
                plan_slug = legacy.plan
                status_value = legacy.status
                if legacy.expires_at:
                    expires_at = legacy.expires_at.isoformat()
                source = "legacy"

        if source == "none":
            agent_tg_ids_stmt = (
                select(Agent.telegram_user_id)
                .where(Agent.tenant_id == tenant_id)
                .distinct()
            )
            result = await self.session.execute(agent_tg_ids_stmt)
            for (agent_tg_id,) in result.all():
                leg = await self.get_active_subscription(tg_user_id=agent_tg_id)
                if leg is not None:
                    plan_label = leg.plan
                    plan_slug = leg.plan
                    status_value = leg.status
                    if leg.expires_at:
                        expires_at = leg.expires_at.isoformat()
                    source = "legacy_agent"
                    break

        free_limits = settings.FREE_PLAN_LIMITS

        agent_count = await self.session.scalar(
            select(func.count(Agent.id)).where(Agent.tenant_id == tenant_id)
        )
        group_count = await self.session.scalar(
            select(func.count(Group.id)).where(Group.tenant_id == tenant_id)
        )

        def _limit(feature_key: str, legacy_key: str | None) -> int | None:
            if source == "owner":
                return None
            pf = plan_features.get(feature_key)
            if pf is not None:
                return pf.limit_value if pf.enabled else 0
            if source in ("legacy", "legacy_agent") and legacy_key:
                return free_limits.get(legacy_key)
            return None

        return {
            "plan": plan_label,
            "plan_slug": plan_slug,
            "status": status_value,
            "source": source,
            "expires_at": expires_at,
            "resources": {
                "agents": {"active": int(agent_count or 0), "limit": _limit("max_agents", None)},
                "groups": {
                    "active": int(group_count or 0),
                    "limit": _limit("max_groups", "max_groups"),
                },
            },
        }
