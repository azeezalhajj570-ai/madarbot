# Phase 0 — MVP Research & Decisions

## Key Decision: Build Simple, Extend Later

Instead of building a full enterprise architecture (Stripe-style products/prices/meters, ClickHouse, event sourcing), start with a **6-table MVP** and add complexity when needed.

| Approach | MVP Choice | Enterprise Future | Why |
|----------|-----------|-------------------|-----|
| Plans | Single `plans` table with price + period | Stripe Products + Prices + Meters | MVP doesn't need Stripe sync day 1 |
| Features | `features` + `plan_features` (config-driven) | Add feature_flags, dependencies, versioning | Core extensibility right from the start |
| Limits | Single `limit` column on plan_features | Hard/soft/grace tiers | One limit is enough to start |
| Usage | Simple integer counter (upsert) | Event sourcing + ClickHouse + streaming | Counters are trivially correct for MVP |
| Resources | Polymorphic `resources` table | Per-type tables with specific schemas | Single table avoids N tables for MVP |
| Organizations | Not in MVP (user_id only) | orgs → workspaces → members | Start flat, nest later |
| Billing | Manual (change plan endpoint) | Stripe webhooks + invoices + dunning | Run before automating payments |
| Analytics | SQL queries on feature_usage | ClickHouse + materialized views + dashboards | Direct SQL is fine for thousands of users |

## Permission Flow

Inspired by GitHub's plan-based authorization. Single gate:

```
Subscription exists + active
  → Plan resolves
    → Feature enabled on plan?
      → Usage < limit? (or unlimited)
        → Allow
```

## Why Simple Counters

- No out-of-order events to reconcile
- No deduplication logic needed
- Queries are single-row lookups
- `INSERT ... ON CONFLICT DO UPDATE` is atomic
- Works with a single PostgreSQL instance
- Easy to migrate to event sourcing later (`feature_usage` → replay events)

## Why Polymorphic Resources

- One `INSERT` to track any resource type
- Adding a new resource type = using it (no migration)
- Filter by `type` for per-resource-type queries
- Can be normalized into per-type tables later

## Extension Paths

Each enterprise feature maps cleanly to a new table:

```
MVP                    Future
─────────────────────────────────────
plans                  + stripe_products, stripe_prices
feature_usage          + usage_events (event sourcing)
resources              + agents, knowledge_bases, channels (per-type)
user_id                + organizations, workspaces, memberships
GET /usage             + materialized views, ClickHouse
manual plan change     + Stripe subscriptions, invoices, webhooks
