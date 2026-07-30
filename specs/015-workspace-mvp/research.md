# Research: Multi-User Workspace MVP

## Decision: Reuse Existing `Tenant` Model as Workspace Entity

**Rationale**: The `Tenant` model (`bot/db/models/tenant.py`) already has `Tenant` (owner, name, slug, is_active) and `TenantMembership` (user_id, role, is_active). Reusing instead of creating a new `Workspace` model avoids schema proliferation and aligns with the existing billing system that already uses `Subscription.tenant_id`.

**Alternatives considered**:
1. New `Workspace` model separate from `Tenant` — rejected because it duplicates `Tenant`'s structure and misses the existing billing integration.
2. Keep the hidden-group hack (`AGENTS_WORKSPACE_TG_GROUP_BASE`) — rejected because it doesn't support multi-user.

## Decision: Subscription Scoped to Tenant (New Billing System)

**Rationale**: The new `Subscription` model (`bot/db/models/billing.py`) is already scoped to `tenant_id` with `Entitlement` for limits. The old `SubscriptionRequest` system (per `tg_user_id`) is kept for backward compat during migration but all new code uses the tenant-scoped billing.

**Alternatives considered**:
1. Add `tenant_id` to old `SubscriptionRequest` — rejected because the new billing system is more feature-complete.
2. Keep per-user subscriptions and add a "shared" pool — rejected as more complex than tenant-scoped.

## Decision: Migration Path — Auto-Create Single-Member Workspace

**Rationale**: Every existing `User` gets a `Tenant` created automatically (name = user's `full_name` or `"My Workspace"`). The user becomes the tenant `owner`. Existing agents and groups that were scoped via `linked_by_user_id` and `owner_user_id` now also get a `tenant_id` column (nullable, backfilled).

**Implementation**:
1. Add `tenant_id` FK to `Agent` and `Group` tables (nullable, default null)
2. Migration script creates a `Tenant` + `TenantMembership(role="owner")` for every `User`
3. Backfill `Agent.tenant_id` and `Group.tenant_id` with the user's tenant
4. Existing queries add `.where(Model.tenant_id == current_tenant_id)` instead of user-based filtering

## Decision: Dashboard Frontend — Minimal Additions

- Workspace switcher dropdown in the header (reusing existing `#/accounts` style)
- Invite modal (simple text input for Telegram username/ID)
- Member list in settings
- All existing pages continue to work; queries get an additional `tenant_id` filter

## Existing Code Patterns to Follow

| Pattern | Location | How to Follow |
|---------|----------|---------------|
| API auth + identity | `dependencies.py` `get_identity` | Extract `tenant_id` from identity and inject |
| Dashboard data fetching | `index.html` `apiRequest` + `state.cache` | Same pattern for workspace endpoints |
| Owner-scoped filtering | Owner endpoints filter by `owner_user_id` | Replace with `tenant_id` filter |
| Subscription check | `dependencies.py` `require_active_subscription` | Add tenant-aware variant |
