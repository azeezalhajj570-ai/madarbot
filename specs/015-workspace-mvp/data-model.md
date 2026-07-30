# Data Model: Multi-User Workspace MVP

> **Note (2026-07-30)**: This document was revised after investigation found `billing.py` was unused dead code (not "already integrated" as originally assumed) and that `groups.tenant_id` already exists in the DB as an orphaned column. See `research.md` for the full corrected rationale. `LinkedAccount`/`ChannelAccount` (the tenant-scoped model built to replace `Agent`) are explicitly **not** used here — see research.md's "Do Not Reuse LinkedAccount" decision.

## Existing Models (Reused)

### Tenant (`bot/db/models/tenant.py`)
```
Tenant
├── id: int (PK)
├── owner_user_id: FK → users.id (NOT NULL)
├── name: str(255)
├── slug: str(128) (unique, nullable)
├── is_active: bool (default: true)
├── business_profile: JSON (default: {})
└── settings_json: JSON (default: {})
```

### TenantMembership (`bot/db/models/tenant.py`)
```
TenantMembership
├── id: int (PK)
├── tenant_id: FK → tenants.id (ON DELETE CASCADE)
├── user_id: FK → users.id (ON DELETE CASCADE)
├── role: str(32) — "owner" | "admin" | "member" | "viewer"
├── is_active: bool (default: true)
└── UNIQUE(tenant_id, user_id)
```

### Subscription (`bot/db/models/billing.py`)
```
Subscription
├── id: int (PK)
├── tenant_id: FK → tenants.id (ON DELETE CASCADE)
├── plan_id: FK → plans.id (nullable)
├── status: str(32) — "pending" | "active" | "past_due" | "cancelled" | "expired"
├── current_period_start: datetime
├── current_period_end: datetime
├── cancelled_at: datetime (nullable)
├── metadata_json: JSON
├── UNIQUE active per tenant (partial index WHERE status = 'active')
```

### Entitlement (`bot/db/models/billing.py`)
```
Entitlement
├── id: int (PK)
├── subscription_id: FK → subscriptions.id (ON DELETE CASCADE)
├── key: str(128) — e.g. "max_agents", "max_groups", "max_members"
└── value: str(512) — stored as string, parsed to int/bool
```

## New Models

### PlanFeature (`bot/db/models/billing.py`) — NEW
Per-plan template of what every subscriber gets; `Entitlement` rows are materialized from this when a `Subscription` is created/renewed. Replaces `feature/015-saas-subscription-architecture`'s standalone `plan_features` table (same purpose, keyed to the existing Integer `plans.id` instead of a new UUID `plans` table).
```
PlanFeature
├── id: int (PK)
├── plan_id: FK → plans.id (ON DELETE CASCADE)
├── feature_key: str(128) — e.g. "chat", "ocr", "max_agents"
├── enabled: bool (default: true)
├── limit_value: int (nullable) — NULL = unlimited
└── UNIQUE(plan_id, feature_key)
```

### FeatureUsage (`bot/db/models/billing.py`) — NEW
Per-subscription usage counters, one row per feature per billing period. Replaces `feature/015-saas-subscription-architecture`'s standalone `feature_usage` table (same purpose, `subscription_id`-scoped instead of raw `user_id`, so usage is naturally shared/pooled across all members of a workspace).
```
FeatureUsage
├── id: int (PK)
├── subscription_id: FK → subscriptions.id (ON DELETE CASCADE)
├── feature_key: str(128)
├── used_count: int (default: 0)
├── period: str(7) — "2026-07" (YYYY-MM)
├── reset_at: datetime (nullable)
└── UNIQUE(subscription_id, feature_key, period)
```

**Not carried over from the #164 draft**: a generic `resources` table (type/count ledger for agents, KBs, workflows). Resource counts are queried directly from their real, already `tenant_id`-scoped tables (`SELECT COUNT(*) FROM agents WHERE tenant_id = ? AND status != 'deleted'`) instead of duplicating that count into a second table that can drift out of sync.

### Explicitly NOT used: `LinkedAccount`, `ChannelAccount` (`bot/db/models/linked_account.py`, `messaging.py`)
These exist in the DB (built to replace `Agent`, per their own docstrings) but are only wired to the WhatsApp/Evolution product line today. Reusing them here would mean migrating campaign/job/runtime execution off `Agent` — out of scope for this MVP. See research.md.

## Modified Models

### Agent (`bot/db/models/agent.py`) — ADD `tenant_id` (new column)
```
Agent (existing columns unchanged, +1 new)
├── ...
├── tenant_id: FK → tenants.id (nullable, NOT NULL after migration)
└── INDEX(tenant_id) for scoped queries
```

### Group (`bot/db/models/group.py`) — MAP existing `tenant_id` column into the ORM
The `groups.tenant_id` column already exists in the database (added nullable by migration `20260504_db_redesign.py`, `ix_groups_tenant_id` index already created) but was never declared on the `Group` model — it's currently invisible to the app and always NULL. No new DB column needed; this is an ORM-only change plus the backfill.
```
Group (existing columns unchanged, +1 newly-mapped — column already exists in DB)
├── ...
├── tenant_id: FK → tenants.id (column exists, nullable; ORM mapping is new; NOT NULL after backfill)
├── owner_user_id: FK → users.id (kept for backward compat)
└── INDEX(tenant_id) — index already exists (ix_groups_tenant_id)
```

### User resolution (`bot/services/user_service.py`) — NEW helper required
`TenantMembership.user_id` and `Tenant.owner_user_id` are FKs to `users.id` (Integer PK). But `identity.user_id` from the dashboard JWT/auth layer, and every router's `actor_user_id`, is the raw `tg_user_id` (BigInteger) — never resolved to `users.id` today. Add:
```
UserService.get_or_create_user_by_tg_id(tg_user_id: int) -> User
```
Called once in the auth dependency chain to resolve `users.id` before any `TenantMembership`/`Tenant` lookup. Without this, workspace membership checks have no valid `user_id` to query against.

## State Transitions

### Workspace Lifecycle
```
User signs up → Tenant auto-created → Owner invites members
                                           ↓
                              Member accepts → Can see/manage all agents & groups
                                           ↓
                              Owner removes member → Member loses access
                                           ↓
                              Owner cancels subscription → Workspace frozen (read-only)
```

### Member Roles
| Role | Can view | Can manage agents | Can invite | Can manage billing |
|------|----------|------------------|------------|-------------------|
| owner | ✅ | ✅ | ✅ | ✅ |
| admin | ✅ | ✅ | ✅ | ❌ |
| member | ✅ | ✅ | ❌ | ❌ |
| viewer | ✅ | ❌ | ❌ | ❌ |

## Migration Plan

1. Add `tenant_id` column to `agents` (nullable). `groups.tenant_id` already exists in the DB — no column migration needed there, only the ORM mapping (see above).
2. Add `PlanFeature` and `FeatureUsage` tables to `billing.py` + Alembic migration.
3. Add `UserService.get_or_create_user_by_tg_id` and wire it into the auth dependency chain (needed before step 4 can resolve real `user_id`s).
4. Create `Tenant` row for every `User` (name = `full_name ?? "My Workspace"`)
5. Create `TenantMembership(role="owner")` for each user → their tenant
6. Backfill `Agent.tenant_id` via `Agent.linked_by_user_id (tg_user_id) → User.tg_user_id → User.id → TenantMembership → tenant_id` (note the join is on `tg_user_id`, not `users.id`, since `linked_by_user_id` stores the Telegram ID)
7. Backfill `Group.tenant_id` via `Group.owner_user_id → TenantMembership → tenant_id` (this join is already on `users.id`, since `Group.owner_user_id` is a proper FK)
8. Make `Agent.tenant_id` and `Group.tenant_id` NOT NULL after backfill
9. Replace `LinkedAccountService.ensure_agents_workspace_group` / drop the `AGENTS_WORKSPACE_TG_GROUP_BASE` hidden-group hack — standalone agents no longer need a fake group, access is `Agent.tenant_id → TenantMembership` directly
10. Backfill `Entitlement` rows for every existing `Subscription` from `PlanFeature` templates (only relevant once `billing.py`'s `Subscription` is actually the live gate — see plan.md Phase ordering)
