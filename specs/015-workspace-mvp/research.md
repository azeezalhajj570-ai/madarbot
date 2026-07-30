# Research: Multi-User Workspace MVP

## Decision: Reuse Existing `Tenant` Model as Workspace Entity

**Rationale**: The `Tenant` model (`bot/db/models/tenant.py`) already has `Tenant` (owner, name, slug, is_active) and `TenantMembership` (user_id, role, is_active). Reusing instead of creating a new `Workspace` model avoids schema proliferation and aligns with the existing billing system that already uses `Subscription.tenant_id`.

**Alternatives considered**:
1. New `Workspace` model separate from `Tenant` — rejected because it duplicates `Tenant`'s structure and misses the existing billing integration.
2. Keep the hidden-group hack (`AGENTS_WORKSPACE_TG_GROUP_BASE`) — rejected because it doesn't support multi-user.

## Correction (2026-07-30): `billing.py` is NOT already integrated

The original draft of this document claimed the tenant-scoped `Subscription`/`Entitlement` system was "already" wired up with `SubscriptionRequest` "kept for backward compat." **This was wrong** — a repo-wide search found zero imports of `bot.db.models.billing` outside the models package itself. `billing.py` (`Product`, `Plan`, `PlanPrice`, `Subscription`, `SubscriptionItem`, `Entitlement`, `Payment`, `CheckoutSession`) was migrated into the DB by `20260504_db_redesign.py` but never wired to any service or router. The only subscription gate live today is `SubscriptionRequest` (`bot/db/models/subscription.py`), keyed on `tg_user_id`, one boolean `plan` string, no real limits.

Separately, branch `feature/015-saas-subscription-architecture` (issue #164, Admission Intelligence usage tracking) independently proposed its **own** `plans`/`subscriptions`/`features`/`plan_features`/`resources`/`feature_usage` schema — UUID-keyed, `user_id BIGINT` (tg_user_id) scoped. Its `plans` and `subscriptions` table names collide directly with the existing-but-unused `billing.py` tables (different PK types, different scoping column) — running both migrations is not possible as designed.

## Decision: Subscription Scoped to Tenant — Extend `billing.py`, Don't Fork It

**Rationale**: Rather than wiring up `billing.py` as-is (workspace-mvp) and separately building a second, incompatible, user-scoped schema (015-saas-subscription-architecture / #164), the two efforts are unified into one tenant-scoped design. `billing.py` already has `Product → Plan → Subscription(tenant_id) → Entitlement(key, value)` — this becomes the canonical `plans`/`subscriptions` schema. Two additions cover what #164 needs on top:

1. **`PlanFeature`** (new, `bot/db/models/billing.py`): `plan_id FK, feature_key str, limit_value int|null`. Template of what every subscriber to a plan gets — `Entitlement` today is only per-subscription-instance, there's no per-plan template to materialize from. `plan_features` in the #164 draft maps onto this, keyed to the existing `plans.id` (Integer) instead of inventing a parallel UUID `plans` table.
2. **`FeatureUsage`** (new, `bot/db/models/billing.py`): `subscription_id FK, feature_key str, used_count int, period str (YYYY-MM), reset_at datetime`. Covers #164's counter requirement (User Story 1/2), scoped to the tenant's subscription instead of a raw `user_id`.

`#164`'s standalone `resources` table (generic type/count tracker for agents/KBs/workflows) is **not** carried over — resource counts (e.g. "how many agents does this tenant have") can be queried directly from the already-`tenant_id`-scoped `Agent`/`Group` tables (`SELECT COUNT(*) FROM agents WHERE tenant_id = ?`); a separate generic ledger table would just be a second, driftable source of truth for numbers the real tables already answer.

**Alternatives considered**:
1. Add `tenant_id` to old `SubscriptionRequest` — rejected, `billing.py` is more feature-complete and already tenant-shaped.
2. Let `feature/015-saas-subscription-architecture` ship its own UUID/user-scoped schema, adapt workspace-mvp to read from it — rejected per user decision: workspace billing must be tenant-scoped since a workspace's whole point is a shared subscription across members; a `user_id`-keyed subscription can't represent that.
3. Keep the two schemas separate and reconcile later — rejected, the table-name collision means one migration will break the other; this has to be resolved before either lands.

**Follow-up required**: `specs/015-saas-subscription-architecture/data-model.md` (branch `feature/015-saas-subscription-architecture`) needs its own update to point at `billing.py` + `PlanFeature` + `FeatureUsage` instead of its standalone 6-table design. Not done as part of this branch — flagged for whoever picks that branch back up.

## Decision: Migration Path — Auto-Create Single-Member Workspace

**Rationale**: Every existing `User` gets a `Tenant` created automatically (name = user's `full_name` or `"My Workspace"`). The user becomes the tenant `owner`. `Agent` gets a new `tenant_id` column. `Group` does **not** need a new column — `groups.tenant_id` already exists in the database (added nullable by `20260504_db_redesign.py`) but was never added to the `Group` ORM model; this work surfaces it in `bot/db/models/group.py` rather than re-adding it.

**Implementation**:
1. Add `tenant_id` FK to `Agent` (new column, nullable, default null)
2. Add the already-existing `tenant_id` column to the `Group` ORM model (no schema change — just map what's already in the DB)
3. Migration script creates a `Tenant` + `TenantMembership(role="owner")` for every `User`
4. Backfill `Agent.tenant_id` and `Group.tenant_id` with the user's tenant
5. Existing queries add `.where(Model.tenant_id == current_tenant_id)` instead of user-based filtering

## Decision: Do Not Reuse `LinkedAccount` for This MVP

**Rationale**: `bot/db/models/linked_account.py` (`LinkedAccount`, `LinkedAccountGroup`) was built in the same May redesign explicitly to **replace** `Agent` (`"Replaces: agents, accounts"` — its own docstring) with a tenant-scoped equivalent. It's real, migrated, tenant-shaped — but today it's used by nothing except the WhatsApp/Evolution messaging product line (`messaging_service.py`, `evolution_service.py`), a different product from the Telegram agent/campaign/broadcast system (`runtime.py`, `worker.py`, `jobs.py`) this feature touches. Migrating `Agent` → `LinkedAccount` would be the architecturally "correct" long-term move (it retires a second scoping scheme instead of adding a third), but it means rewriting campaign execution, job dispatch, and every dashboard router that passes `actor_user_id` — multi-sprint scope on a live product path. Explicitly deferred; MVP adds `tenant_id` directly to `Agent` instead. **This decision should be revisited** the next time `Agent`/campaigns get non-trivial rework — bolting `tenant_id` onto `Agent` now makes that future migration marginally harder, not easier.

## Decision: `tg_user_id` → `users.id` Resolution Is New, Required Work

**Rationale**: `TenantMembership.user_id` and `Tenant.owner_user_id` are FKs to `users.id` (Integer PK). But the entire live authorization path — `identity.user_id` from the dashboard JWT, `actor_user_id` passed through every router (`agents.py` etc.), `Agent.linked_by_user_id`, `GroupAdminRole.user_id` — is the raw Telegram `tg_user_id` (BigInteger), never resolved to `users.id`. Nothing in the original plan accounted for this gap. `UserService` already has tg_user_id-keyed upsert logic (used in `issue_dashboard_token_for_telegram_login` etc.) — this needs a small addition: a `get_or_create_user_by_tg_id(tg_user_id) -> User` helper, called once per request in the auth dependency to resolve `users.id` before any `TenantMembership` lookup.

**Existing precedent worth reusing**: `GroupAdminRole` (`bot/db/models/group_access.py`... actually `access.py`/`group.py`) already implements multi-admin access on real `Group`s today (`group_id`, `user_id`, `role`) — this is effectively a proof that multi-user shared access already works for groups, just not for standalone `Agent`s or at the workspace level. `TenantMembership` generalizes this same pattern one level up; the two can coexist (`GroupAdminRole` for group-specific roles, `TenantMembership` for workspace-wide access) without conflict.

## Decision: Retire `AGENTS_WORKSPACE_TG_GROUP_BASE` for Real

**Rationale**: `LinkedAccountService.ensure_agents_workspace_group` (`bot/agents/linked_account_service.py`) currently creates a synthetic, hidden `Group` per user (`tg_group_id = AGENTS_WORKSPACE_TG_GROUP_BASE - actor_user_id`) purely so standalone agents (not tied to a real Telegram group) have *some* group to hang a `GroupAdminRole` off of. Once `Agent.tenant_id` exists, this is unnecessary — an agent's access is checked via `Agent.tenant_id → TenantMembership(user, tenant)` directly, no fake group required. FR-007 already calls for this hack's removal; this is the concrete mechanism.

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
