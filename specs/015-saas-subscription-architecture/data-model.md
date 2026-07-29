# SaaS MVP — Data Model & Architecture

## Overview

Six tables. Configuration-driven. Simple counters. Extensible.

```
plans             → What we sell
features          → What we offer
plan_features     → Which features each plan gets + limits
subscriptions     → Who has what plan
resources         → What the user owns
feature_usage     → How much they've used
```

---

## 1. Tables

### plans

```sql
CREATE TABLE plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,            -- 'Free', 'Pro', 'Business', 'Enterprise'
    description     TEXT,
    price           INTEGER NOT NULL,         -- in cents ($9.99 = 999)
    billing_period  TEXT NOT NULL DEFAULT 'monthly',  -- 'monthly', 'yearly'
    is_active       BOOLEAN NOT NULL DEFAULT true,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### features

```sql
CREATE TABLE features (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key         TEXT NOT NULL UNIQUE,     -- 'chat', 'ocr', 'voice', 'api'
    name        TEXT NOT NULL,
    description TEXT,
    category    TEXT,                     -- 'ai', 'communication', 'integration'
    is_active   BOOLEAN NOT NULL DEFAULT true,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### plan_features

The single most important table. Controls what every plan allows.

```sql
CREATE TABLE plan_features (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id     UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    feature_id  UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    enabled     BOOLEAN NOT NULL DEFAULT false,
    limit_value BIGINT,                  -- NULL = unlimited, 0 = disabled, >0 = max allowed
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(plan_id, feature_id)
);

CREATE INDEX idx_plan_features_plan ON plan_features(plan_id);
```

### subscriptions

```sql
CREATE TABLE subscriptions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     BIGINT NOT NULL,          -- Telegram user ID (matches existing system)
    plan_id     UUID NOT NULL REFERENCES plans(id),
    status      TEXT NOT NULL DEFAULT 'active',  -- 'trial', 'active', 'expired', 'cancelled'
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
```

### resources

Tracks what the user owns — one table for all resource types.

```sql
CREATE TABLE resources (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     BIGINT NOT NULL,
    type        TEXT NOT NULL,            -- 'agent', 'knowledge_base', 'workflow', 'api_key', 'channel'
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',  -- 'active', 'archived', 'deleted'
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_resources_user_type ON resources(user_id, type);
CREATE INDEX idx_resources_user_status ON resources(user_id, status);
```

### feature_usage

Simple integer counters. One row per user per feature per billing period.

```sql
CREATE TABLE feature_usage (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       BIGINT NOT NULL,
    feature_id    UUID NOT NULL REFERENCES features(id),
    used_count    BIGINT NOT NULL DEFAULT 0,
    period        TEXT NOT NULL,           -- '2026-07' (YYYY-MM)
    source        TEXT NOT NULL DEFAULT 'web',  -- 'web', 'telegram', 'whatsapp', 'api'
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, feature_id, period)
);

CREATE INDEX idx_feature_usage_user ON feature_usage(user_id);
CREATE INDEX idx_feature_usage_period ON feature_usage(period);
```

---

## 2. Permission Flow

```
Request Feature X
    ↓
Lookup user's subscription
    ↓
Resolve plan from subscription
    ↓
Lookup plan_features for (plan_id, feature_id)
    ↓
Is enabled?  →  No → 403 Feature not available
    ↓
Yes
    ↓
Has limit?  →  NULL →  Allow (unlimited)
    ↓
Numeric
    ↓
Lookup feature_usage.used_count for current period
    ↓
used_count < limit_value?  →  No → 429 Limit exceeded
    ↓
Yes
    ↓
ALLOW
    ↓
INCREMENT feature_usage.used_count (+1)
```

### Service Layer Implementation

```python
def can_use_feature(user, feature_key: str) -> bool:
    subscription = get_subscription(user)
    if not subscription or subscription.status not in ('active', 'trial'):
        return False

    pf = get_plan_feature(subscription.plan_id, feature_key)
    if not pf or not pf.enabled:
        return False

    if pf.limit_value is None:
        return True  # unlimited

    usage = get_usage(user, feature_key)
    return usage.used_count < pf.limit_value


def record_usage(user, feature_key: str, source: str = 'web'):
    period = current_period()  # '2026-07'
    upsert_usage(
        user_id=user.id,
        feature_key=feature_key,
        period=period,
        source=source,
    )
```

---

## 3. Quota Calculation

Computed dynamically — never stored.

```
remaining = plan_features.limit_value - feature_usage.used_count
```

```python
def get_quota(user):
    subscription = get_subscription(user)
    features = get_plan_features(subscription.plan_id)

    result = []
    for pf in features:
        usage = get_usage(user, pf.feature_key)
        remaining = None
        if pf.limit_value is not None:
            remaining = max(0, pf.limit_value - usage.used_count)
        result.append({
            "feature": pf.feature_key,
            "name": pf.feature_name,
            "limit": pf.limit_value,
            "used": usage.used_count,
            "remaining": remaining,
        })
    return result
```

---

## 4. API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/subscription` | Current subscription + plan |
| `POST` | `/api/v1/subscription/change` | Change plan (upgrade/downgrade) |
| `GET` | `/api/v1/plans` | List available plans |
| `GET` | `/api/v1/features` | All features with entitlement for current user |
| `GET` | `/api/v1/usage` | Current usage + remaining quota |
| `POST` | `/api/v1/usage/check` | Check quota + record usage atomically |
| `GET` | `/api/v1/resources` | List owned resources |
| `POST` | `/api/v1/resources` | Create a resource |
| `DELETE` | `/api/v1/resources/{id}` | Delete a resource |
| `GET` | `/api/v1/dashboard` | Composite dashboard data |

### Response: GET /api/v1/usage

```json
{
    "plan": "Pro",
    "period": {"start": "2026-07-01", "end": "2026-07-31"},
    "features": [
        {"key": "chat", "name": "Chat", "limit": 10000, "used": 385, "remaining": 9615},
        {"key": "ocr", "name": "OCR", "limit": 500, "used": 12, "remaining": 488},
        {"key": "api", "name": "API", "limit": 100000, "used": 2500, "remaining": 97500},
        {"key": "voice", "name": "Voice", "enabled": false}
    ],
    "resources": {
        "agents": {"active": 2, "limit": 10},
        "knowledge_bases": {"active": 1, "limit": 3}
    }
}
```

### Response: GET /api/v1/plans

```json
{
    "plans": [
        {
            "name": "Free",
            "price": 0,
            "features": [
                {"key": "chat", "name": "Chat", "enabled": true, "limit": 500},
                {"key": "ocr", "name": "OCR", "enabled": false}
            ]
        },
        {
            "name": "Pro",
            "price": 2900,
            "features": [
                {"key": "chat", "name": "Chat", "enabled": true, "limit": 10000},
                {"key": "ocr", "name": "OCR", "enabled": true, "limit": 500}
            ]
        }
    ]
}
```

---

## 5. Dashboard

```
┌─────────────────────────────────────────┐
│  Plan: Pro                              │
│  Status: Active · Renews: Jul 31        │
├─────────────────────────────────────────┤
│  Chat        385 / 10,000  ████░░░░  4% │
│  OCR          12 / 500     ██░░░░░░  2% │
│  API       2,500 / 100,000 ██░░░░░░  3% │
│  Voice        -- / --      disabled     │
├─────────────────────────────────────────┤
│  Agents: 2 / 10   KBs: 1 / 3           │
├─────────────────────────────────────────┤
│  [Upgrade to Business]                  │
└─────────────────────────────────────────┘
```

All values computed from simple queries:

```python
remaining = limit - used  # for each feature
usage_pct = (used / limit * 100) if limit else 0
```

---

## 6. Seed Data

```sql
-- Plans
INSERT INTO plans (id, name, price, billing_period, sort_order) VALUES
    ('p_free', 'Free', 0, 'monthly', 0),
    ('p_pro', 'Pro', 2900, 'monthly', 1),
    ('p_business', 'Business', 9900, 'monthly', 2),
    ('p_enterprise', 'Enterprise', 0, 'yearly', 3);

-- Features
INSERT INTO features (id, key, name, category, sort_order) VALUES
    ('f_chat', 'chat', 'AI Chat', 'ai', 0),
    ('f_kb', 'knowledge_base', 'Knowledge Base', 'ai', 1),
    ('f_whatsapp', 'whatsapp', 'WhatsApp', 'communication', 2),
    ('f_telegram', 'telegram', 'Telegram', 'communication', 3),
    ('f_voice', 'voice', 'Voice', 'ai', 4),
    ('f_ocr', 'ocr', 'OCR', 'ai', 5),
    ('f_api', 'api', 'API Access', 'integration', 6),
    ('f_workflow', 'workflow', 'Workflows', 'automation', 7),
    ('f_analytics', 'analytics', 'Analytics', 'admin', 8);

-- Plan Features (Free)
INSERT INTO plan_features (plan_id, feature_id, enabled, limit_value) VALUES
    ('p_free', 'f_chat', true, 500),
    ('p_free', 'f_kb', true, 1),
    ('p_free', 'f_whatsapp', false, 0),
    ('p_free', 'f_telegram', true, 1),
    ('p_free', 'f_voice', false, 0),
    ('p_free', 'f_ocr', false, 0),
    ('p_free', 'f_api', true, 1000),
    ('p_free', 'f_workflow', false, 0),
    ('p_free', 'f_analytics', false, 0);

-- Plan Features (Pro)
INSERT INTO plan_features (plan_id, feature_id, enabled, limit_value) VALUES
    ('p_pro', 'f_chat', true, 10000),
    ('p_pro', 'f_kb', true, 5),
    ('p_pro', 'f_whatsapp', true, 3),
    ('p_pro', 'f_telegram', true, 10),
    ('p_pro', 'f_voice', true, 500),
    ('p_pro', 'f_ocr', true, 500),
    ('p_pro', 'f_api', true, 100000),
    ('p_pro', 'f_workflow', true, 20),
    ('p_pro', 'f_analytics', true, NULL);
```

---

## 7. Future Extension Points

The schema is designed so these additions don't require touching the 6 core tables:

| Future Feature | How It Grafts On |
|---------------|------------------|
| **Organizations** | New `organizations` table; add `organization_id` to subscriptions, resources, feature_usage |
| **Workspaces** | New `workspaces` table with `organization_id`; add `workspace_id` to resources, feature_usage |
| **Teams/Members** | New `memberships` table joining users to organizations with roles |
| **Event sourcing** | New `usage_events` table (append-only); migrate from direct counter updates |
| **Stripe billing** | Add `stripe_customer_id`, `stripe_subscription_id` to subscriptions |
| **Usage history** | New `usage_history` table or partition feature_usage by period |
| **Cost tracking** | New `cost_records` + `cost_config` tables, linked to usage_events |
| **Analytics** | New `analytics_daily` materialized view or external ClickHouse |
| **Feature flags** | New `feature_flags` table for per-user rollouts |
| **Add-ons** | New `subscription_addons` table, or extend feature_usage with addon_id |
| **Audit logs** | New `audit_log` table, event-driven writes |
| **AI provider tracking** | Add `provider` + `model` columns to usage, or to a new `model_usage` table |
| **Rate limiting** | Use Redis counters keyed by `user_id:feature:window` |
