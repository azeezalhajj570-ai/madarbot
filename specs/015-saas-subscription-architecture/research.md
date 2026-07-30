# Phase 0 — MVP Research & Decisions

## Correction (2026-07-30): Do Not Fork a Second `plans`/`subscriptions` Schema

The original draft of this document proposed a standalone 6-table schema
(`plans`, `features`, `plan_features`, `subscriptions`, `resources`,
`feature_usage`), UUID-keyed, scoped to a raw `user_id BIGINT` (Telegram
user id). Investigation while planning branch `015-workspace-mvp`
(multi-user workspaces) found that:

1. **`plans` and `subscriptions` already exist** — `bot/db/models/billing.py`
   (`Product → Plan → PlanPrice`, `Subscription → Entitlement`), migrated
   into the database by `20260504_db_redesign.py`, Integer-PK, `tenant_id`-scoped.
   Creating a second `plans`/`subscriptions` table set under those same
   names, with a different PK type and a different scoping column, cannot
   coexist with that migration — one of the two would fail outright or
   silently corrupt on `CREATE TABLE`.
2. **User-scoped is the wrong shape.** `015-workspace-mvp` introduces
   `Tenant`/`TenantMembership` so multiple Telegram users can share one
   subscription. A `subscriptions.user_id` design can't represent "two
   people, one plan, one shared quota" — the exact case this feature
   exists to gate.

**Resolution**: this feature builds on `billing.py` instead of forking it.
`015-workspace-mvp` already adds two new tables there for exactly this
purpose:

- **`PlanFeature`** (`plan_id → plans.id`, `feature_key`, `enabled`,
  `limit_value`) — replaces this doc's `plan_features` table. Same
  purpose (per-plan template of what's enabled and at what limit), keyed
  to the existing Integer `plans.id` instead of a new UUID `plans` table.
- **`FeatureUsage`** (`subscription_id → subscriptions.id`, `feature_key`,
  `used_count`, `period`, `reset_at`) — replaces this doc's `feature_usage`
  table. Same purpose (per-period usage counters), scoped to the tenant's
  `Subscription` instead of a raw `user_id`, so usage is naturally pooled
  across everyone in a workspace rather than fragmented per person.

**Dependency**: this feature must be implemented on top of
`015-workspace-mvp` (or after it merges) — `PlanFeature`/`FeatureUsage`
live there, not here.

## Key Decision: Build Simple, Extend Later

Instead of building a full enterprise architecture (Stripe-style
products/prices/meters, ClickHouse, event sourcing), start with the
existing `billing.py` schema plus two new tables and add complexity when
needed. Most of the "MVP choice" column below is unchanged from the
original draft — the correction above only changes *where* `plans` and
`subscriptions` live, not the surrounding design philosophy.

| Approach | MVP Choice | Enterprise Future | Why |
|----------|-----------|-------------------|-----|
| Plans | Existing `billing.py` `Product → Plan → PlanPrice` | Stripe Products + Prices + Meters | Already migrated; avoid a second catalog |
| Features | `PlanFeature` (config-driven `feature_key` string) | Normalized `Feature` catalog + flags, dependencies, versioning | A catalog table is a UI nicety, not a blocker — add later if per-feature display metadata (name/category) is needed beyond a static lookup |
| Limits | Single `limit_value` column on `PlanFeature` | Hard/soft/grace tiers | One limit is enough to start |
| Usage | `FeatureUsage`, simple integer counter (upsert) | Event sourcing + ClickHouse + streaming | Counters are trivially correct for MVP |
| Resources | Query existing typed tables directly (`Agent`, `Group`, ...) | Per-type tables with specific schemas | The typed tables already exist and are already `tenant_id`-scoped — a polymorphic `resources` ledger would just be a second, driftable source of truth for counts the real tables already answer |
| Tenancy | `Subscription.tenant_id` (workspace-scoped, from `015-workspace-mvp`) | orgs → workspaces → members (already the shape) | Tenancy lands with workspace-mvp; this feature rides on it rather than starting flat and re-nesting later |
| Billing | Manual (change plan endpoint) | Stripe webhooks + invoices + dunning | Run before automating payments |
| Analytics | SQL queries on `FeatureUsage` | ClickHouse + materialized views + dashboards | Direct SQL is fine for thousands of users |

## Permission Flow

Inspired by GitHub's plan-based authorization. Single gate — unchanged
from the original draft, just resolved through `Subscription.tenant_id`
instead of a raw `user_id`:

```
Subscription exists + active (looked up by tenant_id)
  → Plan resolves
    → PlanFeature enabled for (plan_id, feature_key)?
      → FeatureUsage.used_count < limit_value? (or unlimited)
        → Allow
```

## Why Simple Counters

- No out-of-order events to reconcile
- No deduplication logic needed
- Queries are single-row lookups
- `INSERT ... ON CONFLICT DO UPDATE` is atomic
- Works with a single PostgreSQL instance
- Easy to migrate to event sourcing later (`feature_usage` → replay events)

## Why Not a Polymorphic `resources` Table

The original draft proposed a generic `resources` table (`type`, `name`,
`status`) to count agents/knowledge-bases/workflows against per-plan
limits with one code path. Reconsidered: every resource type in this
codebase already has its own real, `tenant_id`-scoped table (`Agent`,
`Group`, and whatever knowledge-base/workflow tables exist). Counting via
`SELECT COUNT(*) FROM agents WHERE tenant_id = ? AND status != 'deleted'`
costs one query per resource type and stays correct by construction —
there's nothing to keep in sync. A polymorphic ledger buys a single code
path at the cost of a second number that can silently drift from the real
one. Revisit only if a genuinely generic resource type (with no dedicated
table) shows up.

## Extension Paths

Each enterprise feature maps cleanly to a new table or column:

```
MVP                              Future
──────────────────────────────────────────────────────────────
billing.py Plan/PlanPrice        + stripe_product_id, stripe_price_id (already has stripe_price_id on PlanPrice)
FeatureUsage                     + usage_events (event sourcing)
Feature counts via typed tables  + normalized per-type tables if a type needs one
Subscription.tenant_id           (already the shape — no further nesting needed for orgs/workspaces)
GET /usage                       + materialized views, ClickHouse
manual plan change                + Stripe subscriptions, invoices, webhooks
PlanFeature.feature_key (string) + normalized Feature catalog table, if display metadata (name/category/icon) grows past a static lookup
```
