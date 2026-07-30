# Implementation Plan: SaaS Subscription, Usage & Analytics System

**Branch**: `feature/015-saas-subscription-architecture` | **Date**: 2026-07-29 | **Spec**: User input (14-part architecture design)

**Input**: MVP SaaS subscription + usage architecture for MadarBot. 6-table core (plans, features, plan_features, subscriptions, resources, feature_usage) with configuration-driven features and clear extension points for future enterprise features.

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

MVP design for MadarBot subscription and usage tracking. Builds on the
existing (already-migrated, currently unused) `bot/db/models/billing.py`
schema — `Product → Plan → PlanPrice → Subscription → Entitlement` — plus
two new tables, `PlanFeature` and `FeatureUsage`, added by branch
`015-workspace-mvp`. Configuration-driven — adding a feature means a
`PlanFeature` row, not a schema change. Permission flow: Subscription
(tenant-scoped) → Plan → Feature Enabled? → Usage < Limit? → Allow. Simple
integer counters for usage. Dynamic quota calculation (limit - used).

**Revised 2026-07-30**: the original draft proposed a standalone,
UUID-keyed, `user_id`-scoped 6-table schema (`plans`, `features`,
`plan_features`, `subscriptions`, `resources`, `feature_usage`) that
collides table-for-table with `billing.py` and can't represent a shared
workspace subscription. See `research.md` for the full rationale. **This
feature now depends on `015-workspace-mvp`** (tenant/workspace model +
`PlanFeature`/`FeatureUsage`) and should be sequenced after it.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: Python 3.11+, TypeScript/React (dashboard)

**Primary Dependencies**: FastAPI, SQLAlchemy (async), Alembic, PostgreSQL 16

**Storage**: PostgreSQL 16 (existing `billing.py` tables + `PlanFeature`/`FeatureUsage` from `015-workspace-mvp`)

**Testing**: pytest, pytest-asyncio

**Target Platform**: Linux server (Docker)

**Project Type**: Web service (backend API + HTML dashboard)

**Performance Goals**: <200ms p95 for subscription/feature reads, simple counters fast enough for MVP scale (thousands of users)

**Constraints**: MVP scope — no event sourcing, no streaming, no background workers yet. Must not create tables that collide with `bot/db/models/billing.py`.

**Scale/Scope**: MVP — single database, single region. Tenancy is workspace-scoped via `Tenant`/`Subscription.tenant_id` (from `015-workspace-mvp`) rather than per-user — this feature rides on that shape instead of starting flat.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Pre-Phase 0: All gates PASS.**
**Post-Phase 1 Re-evaluation (2026-07-29): All gates still PASS.**

| Gate | Pre-Phase0 | Post-Phase1 | Rationale |
|------|-----------|-------------|-----------|
| I. Security & Secrets Management | PASS | PASS | No secrets in the design; user_id scoping enforced |
| II. Code Quality | PASS | PASS | Simple 6-table schema, single-responsibility service layer |
| III. Testing Standards | PASS | PASS | Simple counters trivially testable; tests deferred to implementation |
| IV. User Experience Consistency | PASS | PASS | Dashboard UX defined with plan/usage display; consistent error format |
| V. Performance Requirements | PASS | PASS | Single table queries with indexes; counters are simple integers — fast at MVP scale |
| VI. Async-First & Event-Driven | PASS | PASS | Counter updates are synchronous (fast path); background aggregation deferred |
| VII. Containerized Infrastructure | PASS | PASS | Single extra service in compose (none — uses existing backend container) |
| VIII. Structured Observability | PASS | PASS | Simple logging on permission checks; structured events added later |

**All gates PASS. No violations requiring justification.**

## Project Structure

### Documentation (this feature)

```text
specs/015-saas-subscription-architecture/
├── plan.md              # This file
├── research.md          # Phase 0 — research findings & decisions
├── data-model.md        # Phase 1 — full entity-relationship design
├── quickstart.md        # Phase 1 — implementation quickstart guide
├── contracts/           # Phase 1 — API contracts
│   └── api-spec.md      # REST API specification
└── tasks.md             # Phase 2 — implementation tasks (not created here)
```

### Source Code (repository root)

```text
bot/
├── db/models/
│   └── billing.py                  # EXISTING (015-workspace-mvp adds PlanFeature, FeatureUsage)
│                                    #   MODIFY here: seed the remaining feature_key rows (chat, ocr, ...)
├── services/
│   └── subscription_service.py     # EXISTING — extend with can_use_feature/record_usage/get_quota
├── dashboard/api/
│   ├── routers/subscription.py     # EXISTING — extend with /api/plans, /api/usage, /api/usage/check
│   └── dependencies.py             # EXISTING (015-workspace-mvp) — feature gates read WorkspaceContext.tenant_id
dashboard/src/                      # React admin app (bot/dashboard/browser/) — extend SubscriptionsPage
tests/
└── services/
    └── test_subscription_service.py
```

**Structure Decision**: No new `bot/billing/` module — extends the
existing `billing.py` models and `subscription_service.py` instead of
standing up a parallel domain, since a working `Product/Plan/Subscription`
schema and service already exist (they were just never wired to a live
gate). Frontend changes land in `dashboard/src/` (the real React admin
app — see `015-workspace-mvp`'s frontend work for the current build
pipeline; the plan's original `bot/dashboard/frontend/templates/` target
doesn't correspond to anything served today).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
