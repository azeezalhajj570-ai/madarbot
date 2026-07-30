# MVP Implementation Quickstart

> **Revised 2026-07-30**: builds on `bot/db/models/billing.py` +
> `PlanFeature`/`FeatureUsage` (added by `015-workspace-mvp`) instead of a
> standalone `bot/billing/` module. See `research.md` and `plan.md` for
> why. **Sequence this after `015-workspace-mvp` merges** — `PlanFeature`
> and `FeatureUsage` don't exist until then.

## 1. Migration

No new tables needed — `PlanFeature`/`FeatureUsage` already exist from
`015-workspace-mvp`. This feature only adds seed rows:

```bash
alembic revision -m "seed_saas_plan_features"
# fill in the INSERT ... SELECT statements from data-model.md section 6
alembic upgrade head
```

## 2. Seed the Remaining Feature Keys

`015-workspace-mvp` already seeds `max_agents`/`max_groups`. Add the rest
(`chat`, `ocr`, `voice`, `api`, `knowledge_base`, `whatsapp`, `telegram`,
`workflow`, `analytics`) via the migration in step 1, or a one-off script
if seed data needs to change independently of a migration.

## 3. Core Service — Extend `SubscriptionService`

```python
# bot/services/subscription_service.py — add to the existing class

async def can_use_feature(self, *, tenant_id: int, feature_key: str) -> bool:
    subscription = await self.get_active_subscription_for_tenant(tenant_id)
    if subscription is None:
        return False

    plan_feature = await self._get_plan_feature(subscription.plan_id, feature_key)
    if plan_feature is None or not plan_feature.enabled:
        return False

    if plan_feature.limit_value is None:
        return True  # unlimited

    usage = await self._get_usage(subscription.id, feature_key)
    return usage.used_count < plan_feature.limit_value


async def record_usage(self, *, tenant_id: int, feature_key: str) -> None:
    subscription = await self.get_active_subscription_for_tenant(tenant_id)
    period = current_period()  # '2026-07'
    await self._upsert_usage(subscription.id, feature_key, period)
```

`get_active_subscription_for_tenant` needs to be added too — the existing
`SubscriptionService` methods are all `tg_user_id`-keyed (the legacy
`SubscriptionRequest` gate); this is the tenant-scoped counterpart.

## 4. Wire in as a FastAPI Dependency

```python
# bot/dashboard/api/dependencies.py

def require_feature(feature_key: str):
    async def _check(
        ctx: WorkspaceContext = Depends(get_workspace_context),
        session: AsyncSession = Depends(get_session),
    ) -> None:
        if not await SubscriptionService(session).can_use_feature(
            tenant_id=ctx.tenant_id, feature_key=feature_key
        ):
            raise HTTPException(403, "Feature not available on your plan")
    return _check

# Usage in routes
@router.post("/api/chat")
async def chat(..., _=Depends(require_feature("chat"))):
    await SubscriptionService(session).record_usage(tenant_id=ctx.tenant_id, feature_key="chat")
```

Note the dependency is `get_workspace_context` (from `015-workspace-mvp`),
not a raw `identity.user_id` — feature gates must resolve the *workspace's*
subscription, not any individual member's.

## 5. Dashboard Route

```python
@router.get("/api/usage")
async def usage(
    ctx: WorkspaceContext = Depends(get_workspace_context),
    session: AsyncSession = Depends(get_session),
) -> dict:
    quota = await SubscriptionService(session).get_quota(ctx.tenant_id)
    agent_count = await session.scalar(
        select(func.count(Agent.id)).where(Agent.tenant_id == ctx.tenant_id)
    )
    group_count = await session.scalar(
        select(func.count(Group.id)).where(Group.tenant_id == ctx.tenant_id)
    )
    return {"features": quota, "resources": {"agents": agent_count, "groups": group_count}}
```

## 6. Verify

```bash
# Check plans
curl /api/plans

# Get usage for the active workspace
curl /api/usage -H "Authorization: Bearer $TOKEN"

# Check + record usage atomically
curl -X POST /api/usage/check \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"feature_key": "chat", "quantity": 1}'
```
