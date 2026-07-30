# SaaS MVP — Data Model & Architecture

> **Revised 2026-07-30.** The original version of this document specified
> a standalone 6-table schema (`plans`, `features`, `plan_features`,
> `subscriptions`, `resources`, `feature_usage`), UUID-keyed and scoped to
> a raw Telegram `user_id`. That collides table-for-table with the
> already-migrated, tenant-scoped `bot/db/models/billing.py` schema and
> can't represent a shared workspace subscription. See `research.md` for
> the full rationale. This version builds on `billing.py` +
> `PlanFeature`/`FeatureUsage` (added by branch `015-workspace-mvp` —
> **this feature depends on that branch**) instead of forking a second
> schema.

## Overview

Configuration-driven. Simple counters. Extensible. Four tables carry the
whole feature — two already exist, two are new (added on `015-workspace-mvp`):

```
Product / Plan / PlanPrice   → What we sell (existing, billing.py)
Subscription                 → Which tenant (workspace) has what plan (existing, billing.py)
PlanFeature                  → Which features each plan gets + limits (new, billing.py)
FeatureUsage                 → How much a subscription has used (new, billing.py)
```

No `features` catalog table and no polymorphic `resources` table — see
`research.md`'s "Why Not a Polymorphic resources Table" for why resource
counts are queried directly from their real tables instead.

---

## 1. Tables

### Product, Plan, PlanPrice (`bot/db/models/billing.py` — existing, unchanged)

Already migrated by `20260504_db_redesign.py`, already seeded with a
`madarbot` product and `starter`/`business`/`enterprise` plans + monthly/
yearly prices.

```
Plan
├── id: int (PK)
├── product_id: FK → products.id
├── name, slug, description, sort_order, is_active
```

### Subscription (`bot/db/models/billing.py` — existing, unchanged)

```
Subscription
├── id: int (PK)
├── tenant_id: FK → tenants.id            -- the workspace, not a user
├── plan_id: FK → plans.id (nullable)
├── status: 'pending' | 'active' | 'past_due' | 'cancelled' | 'expired'
├── current_period_start, current_period_end, trial_end
├── UNIQUE active subscription per tenant (partial index)
```

This is the load-bearing change from the original draft: subscriptions
are per-workspace (`tenant_id`), not per-Telegram-user. Every member of a
workspace shares the same plan and the same usage counters.

### PlanFeature (`bot/db/models/billing.py` — new, from `015-workspace-mvp`)

Per-plan feature template — what every subscriber to a plan gets. This is
the table this doc's original `plan_features` mapped onto, minus the UUID
PK and the separate `features` catalog FK (a bare string key is enough
for MVP — see research.md).

```sql
-- Already added by 015-workspace-mvp's migration 20260730_001
CREATE TABLE plan_features (
    id           INTEGER PRIMARY KEY,
    plan_id      INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    feature_key  VARCHAR(128) NOT NULL,       -- 'chat', 'ocr', 'voice', 'api', 'max_agents', ...
    enabled      BOOLEAN NOT NULL DEFAULT true,
    limit_value  INTEGER,                     -- NULL = unlimited
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(plan_id, feature_key)
);
CREATE INDEX ix_plan_features_plan_id ON plan_features(plan_id);
CREATE INDEX ix_plan_features_feature_key ON plan_features(feature_key);
```

`015-workspace-mvp` already seeds `max_agents`/`max_groups` rows for
starter/business/enterprise. This feature adds the remaining product
feature keys this doc originally proposed (`chat`, `ocr`, `voice`, `api`,
`knowledge_base`, `whatsapp`, `telegram`, `workflow`, `analytics`) as
additional `PlanFeature` rows on the same three plans — no schema change,
just more rows, matching the "config-driven" principle from the original
draft.

### FeatureUsage (`bot/db/models/billing.py` — new, from `015-workspace-mvp`)

Per-subscription usage counters, one row per feature per billing period.
This is the table this doc's original `feature_usage` mapped onto,
`subscription_id`-scoped instead of raw `user_id`.

```sql
-- Already added by 015-workspace-mvp's migration 20260730_001
CREATE TABLE feature_usage (
    id               INTEGER PRIMARY KEY,
    subscription_id  INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    feature_key      VARCHAR(128) NOT NULL,
    used_count       INTEGER NOT NULL DEFAULT 0,
    period           VARCHAR(7) NOT NULL,        -- '2026-07' (YYYY-MM)
    reset_at         TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(subscription_id, feature_key, period)
);
CREATE INDEX ix_feature_usage_subscription_id ON feature_usage(subscription_id);
CREATE INDEX ix_feature_usage_feature_key ON feature_usage(feature_key);
CREATE INDEX ix_feature_usage_period ON feature_usage(period);
```

Because usage is keyed by `subscription_id` (the workspace's one shared
subscription), every member of a workspace draws from the same quota —
this is what makes "one subscription covers a team" actually work,
instead of each member separately hitting their own limit.

### Resource counts — no table

Original draft: a polymorphic `resources` table (`type`, `status`, ...)
tracking agent/knowledge-base/workflow counts against `PlanFeature.limit_value`
for keys like `max_agents`. Instead, count directly from the real,
already `tenant_id`-scoped tables:

```sql
SELECT COUNT(*) FROM agents WHERE tenant_id = :tenant_id;
SELECT COUNT(*) FROM groups WHERE tenant_id = :tenant_id;
```

No new table, no second number to keep in sync with the real one.

---

## 2. Permission Flow

Unchanged in shape from the original draft — only the lookup key changes
(`tenant_id`'s active subscription, not a raw `user_id`):

```
Request Feature X (on behalf of tenant_id)
    ↓
Lookup tenant's active Subscription
    ↓
Resolve Plan from subscription.plan_id
    ↓
Lookup PlanFeature for (plan_id, feature_key)
    ↓
Is enabled?  →  No → 403 Feature not available
    ↓
Yes
    ↓
Has limit_value?  →  NULL →  Allow (unlimited)
    ↓
Numeric
    ↓
Lookup FeatureUsage.used_count for (subscription_id, feature_key, current period)
    ↓
used_count < limit_value?  →  No → 429 Limit exceeded
    ↓
Yes
    ↓
ALLOW
    ↓
INCREMENT FeatureUsage.used_count (+1)
```

### Service Layer Implementation

```python
# bot/services/subscription_service.py — extend, don't fork a new bot/billing/ module
# (SubscriptionService already exists; add feature-gate methods to it)

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

---

## 3. Quota Calculation

Computed dynamically — never stored. Unchanged from the original draft:

```
remaining = plan_feature.limit_value - feature_usage.used_count
```

```python
async def get_quota(self, tenant_id: int) -> list[dict]:
    subscription = await self.get_active_subscription_for_tenant(tenant_id)
    plan_features = await self._list_plan_features(subscription.plan_id)

    result = []
    for pf in plan_features:
        usage = await self._get_usage(subscription.id, pf.feature_key)
        remaining = None
        if pf.limit_value is not None:
            remaining = max(0, pf.limit_value - usage.used_count)
        result.append({
            "feature": pf.feature_key,
            "limit": pf.limit_value,
            "used": usage.used_count,
            "remaining": remaining,
        })
    return result
```

---

## 4. API

Paths follow this repo's actual router convention (`/api/...` +
`/webapp/...` dual registration, see `bot/dashboard/api/routers/`) instead
of the original draft's `/api/v1/...` — there is no `/api/v1` prefix
anywhere else in this codebase.

| Method | Path | Description |
|--------|------|--------------|
| `GET` | `/api/subscription` | Current workspace's subscription + plan (uses `active_workspace_id` from `WorkspaceContext`, see `015-workspace-mvp`) |
| `POST` | `/api/subscription/change` | Change plan (upgrade/downgrade) |
| `GET` | `/api/plans` | List available plans (existing `Plan`/`PlanPrice` + their `PlanFeature`s) |
| `GET` | `/api/usage` | Current usage + remaining quota for the active workspace |
| `POST` | `/api/usage/check` | Check quota + record usage atomically |

### Response: GET /api/usage

```json
{
    "plan": "business",
    "period": {"start": "2026-07-01", "end": "2026-07-31"},
    "features": [
        {"key": "chat", "limit": 10000, "used": 385, "remaining": 9615},
        {"key": "ocr", "limit": 500, "used": 12, "remaining": 488},
        {"key": "api", "limit": 100000, "used": 2500, "remaining": 97500},
        {"key": "voice", "enabled": false}
    ],
    "resources": {
        "agents": {"active": 2, "limit": 3},
        "groups": {"active": 14, "limit": 50}
    }
}
```

### Response: GET /api/plans

```json
{
    "plans": [
        {
            "slug": "starter",
            "name": "Starter",
            "price_monthly_cents": 2900,
            "features": [
                {"key": "chat", "enabled": true, "limit": 500},
                {"key": "ocr", "enabled": false},
                {"key": "max_agents", "enabled": true, "limit": 1},
                {"key": "max_groups", "enabled": true, "limit": 5}
            ]
        },
        {
            "slug": "business",
            "name": "Business",
            "price_monthly_cents": 7900,
            "features": [
                {"key": "chat", "enabled": true, "limit": 10000},
                {"key": "ocr", "enabled": true, "limit": 500},
                {"key": "max_agents", "enabled": true, "limit": 3},
                {"key": "max_groups", "enabled": true, "limit": 50}
            ]
        }
    ]
}
```

---

## 5. Dashboard

Unchanged from the original draft (this is UI, not schema):

```
┌─────────────────────────────────────────┐
│  Plan: Business                          │
│  Status: Active · Renews: Jul 31        │
├─────────────────────────────────────────┤
│  Chat        385 / 10,000  ████░░░░  4% │
│  OCR          12 / 500     ██░░░░░░  2% │
│  API       2,500 / 100,000 ██░░░░░░  3% │
│  Voice        -- / --      disabled     │
├─────────────────────────────────────────┤
│  Agents: 2 / 3    Groups: 14 / 50       │
├─────────────────────────────────────────┤
│  [Upgrade to Enterprise]                 │
└─────────────────────────────────────────┘
```

```python
remaining = limit - used  # for each feature
usage_pct = (used / limit * 100) if limit else 0
```

---

## 6. Seed Data

`starter`/`business`/`enterprise` plans and their `max_agents`/`max_groups`
`PlanFeature` rows are already seeded by `015-workspace-mvp`'s migration.
This feature adds the remaining product feature keys as more `PlanFeature`
rows on the same plans — no new plans, no new schema:

```sql
INSERT INTO plan_features (plan_id, feature_key, enabled, limit_value)
SELECT id, 'chat', true, 500 FROM plans WHERE slug = 'starter'
UNION ALL SELECT id, 'knowledge_base', true, 1 FROM plans WHERE slug = 'starter'
UNION ALL SELECT id, 'whatsapp', false, 0 FROM plans WHERE slug = 'starter'
UNION ALL SELECT id, 'telegram', true, 1 FROM plans WHERE slug = 'starter'
UNION ALL SELECT id, 'voice', false, 0 FROM plans WHERE slug = 'starter'
UNION ALL SELECT id, 'ocr', false, 0 FROM plans WHERE slug = 'starter'
UNION ALL SELECT id, 'api', true, 1000 FROM plans WHERE slug = 'starter'
UNION ALL SELECT id, 'workflow', false, 0 FROM plans WHERE slug = 'starter'
UNION ALL SELECT id, 'analytics', false, 0 FROM plans WHERE slug = 'starter'

UNION ALL SELECT id, 'chat', true, 10000 FROM plans WHERE slug = 'business'
UNION ALL SELECT id, 'knowledge_base', true, 5 FROM plans WHERE slug = 'business'
UNION ALL SELECT id, 'whatsapp', true, 3 FROM plans WHERE slug = 'business'
UNION ALL SELECT id, 'telegram', true, 10 FROM plans WHERE slug = 'business'
UNION ALL SELECT id, 'voice', true, 500 FROM plans WHERE slug = 'business'
UNION ALL SELECT id, 'ocr', true, 500 FROM plans WHERE slug = 'business'
UNION ALL SELECT id, 'api', true, 100000 FROM plans WHERE slug = 'business'
UNION ALL SELECT id, 'workflow', true, 20 FROM plans WHERE slug = 'business'
UNION ALL SELECT id, 'analytics', true, NULL FROM plans WHERE slug = 'business'

UNION ALL SELECT id, key, true, NULL FROM plans, (VALUES
    ('chat'), ('knowledge_base'), ('whatsapp'), ('telegram'),
    ('voice'), ('ocr'), ('api'), ('workflow'), ('analytics')
) AS f(key) WHERE plans.slug = 'enterprise'
ON CONFLICT DO NOTHING;
```

---

## 7. Future Extension Points

Unchanged in spirit from the original draft — the schema is designed so
these additions don't require touching the core tables:

| Future Feature | How It Grafts On |
|---------------|------------------|
| **Feature display metadata** | Normalized `Feature` catalog table (`key`, `name`, `category`) if a static Python lookup stops being enough for the dashboard |
| **Event sourcing** | New `usage_events` table (append-only); migrate from direct `FeatureUsage` counter updates |
| **Stripe billing** | `PlanPrice.stripe_price_id` already exists; add `stripe_subscription_id` to `Subscription` (both already columns on the existing models) |
| **Usage history** | New `usage_history` table or partition `feature_usage` by period |
| **Cost tracking** | New `cost_records` + `cost_config` tables, linked to usage events |
| **Analytics** | New `analytics_daily` materialized view or external ClickHouse |
| **Feature flags** | New `feature_flags` table for per-tenant rollouts |
| **Add-ons** | New `subscription_addons` table, or extend `FeatureUsage` with an `addon_id` |
| **Audit logs** | `audit_logs` table already exists (`20260504_db_redesign.py`) — wire subscription/plan changes into it |
| **AI provider tracking** | Add `provider` + `model` columns to usage, or a new `model_usage` table |
| **Rate limiting** | Redis counters keyed by `tenant_id:feature:window` |
