# Implementation Plan: SaaS Subscription, Usage & Analytics System

**Branch**: `feature/015-saas-subscription-architecture` | **Date**: 2026-07-29 | **Spec**: User input (14-part architecture design)

**Input**: MVP SaaS subscription + usage architecture for MadarBot. 6-table core (plans, features, plan_features, subscriptions, resources, feature_usage) with configuration-driven features and clear extension points for future enterprise features.

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

MVP design for MadarBot subscription and usage tracking. Six tables: `plans`, `features`, `plan_features`, `subscriptions`, `resources`, `feature_usage`. Configuration-driven — adding a feature means a DB row, not a schema change. Permission flow: Subscription → Plan → Feature Enabled? → Usage < Limit? → Allow. Simple integer counters for usage. Dynamic quota calculation (limit - used). Clear extension points for future: organizations, workspaces, event sourcing, billing integration, cost tracking.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: Python 3.11+, TypeScript/React (dashboard)

**Primary Dependencies**: FastAPI, SQLAlchemy (async), Alembic, PostgreSQL 16

**Storage**: PostgreSQL 16 (single database, all 6 tables)

**Testing**: pytest, pytest-asyncio

**Target Platform**: Linux server (Docker)

**Project Type**: Web service (backend API + HTML dashboard)

**Performance Goals**: <200ms p95 for subscription/feature reads, simple counters fast enough for MVP scale (thousands of users)

**Constraints**: MVP scope — no event sourcing, no streaming, no background workers yet

**Scale/Scope**: MVP — single database, single region, single-tenant per user (no orgs/workspaces yet)

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
├── billing/                  # NEW: subscription + plans module
│   ├── __init__.py
│   ├── models.py             # SQLAlchemy models: Plan, Feature, PlanFeature, Subscription
│   ├── schemas.py            # Pydantic request/response schemas
│   ├── service.py            # Permission flow + quota logic
│   └── router.py             # FastAPI routes
├── db/
│   ├── models/
│   │   └── billing.py        # All 6 tables in one file
│   └── migrations/           # Alembic migrations
├── dashboard/
│   └── frontend/
│       └── templates/        # Subscription dashboard pages
tests/
└── billing/
    ├── test_models.py
    ├── test_service.py
    └── test_router.py
```

**Structure Decision**: New bounded domains (`billing/`, `analytics/`, `events/`) added alongside existing backend structure. Follows the existing FastAPI + SQLAlchemy patterns in `bot/`. Frontend dashboard pages extended in `bot/dashboard/frontend/`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
