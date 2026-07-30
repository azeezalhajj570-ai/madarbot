# Implementation Plan: Multi-User Workspace MVP

**Branch**: `015-workspace-mvp` | **Date**: 2026-07-30 | **Spec**: `specs/015-workspace-mvp/spec.md`

**Input**: Feature specification from `specs/015-workspace-mvp/spec.md`

## Summary

Reuse the existing `Tenant` model as the workspace entity to let multiple Telegram users share management of agents, groups, and a single subscription. Each existing user gets an auto-created single-member workspace via migration. The hidden `AGENTS_WORKSPACE_TG_GROUP_BASE` hack is replaced by the `Tenant` model. Minimal API additions: workspace CRUD, member invitations, and re-scoping existing agent/group queries to `tenant_id`.

**Revised 2026-07-30** after investigation surfaced three gaps in the original plan (see `research.md` for full rationale):
1. `billing.py`'s `Subscription`/`Entitlement` is currently dead code (not "already integrated" as first assumed) — this branch is what actually wires it up, and adds `PlanFeature`/`FeatureUsage` to also cover branch `feature/015-saas-subscription-architecture`'s (#164) usage-tracking needs, avoiding two incompatible `plans`/`subscriptions` schemas.
2. `groups.tenant_id` already exists as a DB column (added by `20260504_db_redesign.py`) but was never mapped in the `Group` ORM model — this is a surfacing job, not a new migration, for `Group`.
3. Every live `actor_user_id` in the dashboard API is a raw `tg_user_id`, while `TenantMembership`/`Tenant` key on `users.id` — a new `get_or_create_user_by_tg_id` resolver is required before any membership check can run.

`LinkedAccount`/`ChannelAccount` (a separate tenant-scoped schema already built to replace `Agent`, but only wired to the WhatsApp/Evolution product line) is explicitly **not** reused here — see research.md's "Do Not Reuse LinkedAccount" decision.

## Technical Context

**Language/Version**: Python 3.11+

**Primary Dependencies**: FastAPI, SQLAlchemy async, Pydantic

**Storage**: PostgreSQL 16 (via asyncpg) + Redis 7

**Testing**: pytest + pytest-asyncio

**Target Platform**: Linux server (Docker)

**Project Type**: Web service (FastAPI backend + vanilla JS dashboard)

**Performance Goals**: <500ms p95 for all new endpoints; N+1 queries forbidden

**Constraints**: Must coexist with existing single-user scoping during migration; must not break existing dashboard pages

**Scale/Scope**: MVP: workspaces with 2-5 members, ~50 workspaces initially

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status |
|------|--------|
| I. Security & Secrets Management — no secrets exposed | ✅ New endpoints use existing auth patterns |
| II. Code Quality — ruff/mypy must pass | ✅ Must enforce pre-commit |
| III. Testing Standards — tests required for new logic | ⚠️ MVP scope may skip exhaustive tests — **justification needed** |
| IV. UX Consistency — dashboard patterns must match | ✅ Follow existing pattern (apiRequest, caching, etc.) |
| V. Performance — N+1 queries forbidden | ✅ Must audit new queries; reuse existing patterns |
| VI. Async-First — all I/O must be async | ✅ Existing async patterns reused |
| VII. Containerized Infrastructure | ✅ No infra changes needed |
| VIII. Structured Observability — logging for state changes | ✅ Add structured events for workspace create/invite |

**⚠️ Gate III (Testing Standards)**: For MVP, manual testing + smoke tests are acceptable for workspace CRUD and member invitations. Full test coverage (unit + integration) is deferred to post-MVP hardening. This is justified because the feature is a thin layer over existing models and patterns.

## Project Structure

### Documentation (this feature)

```text
specs/015-workspace-mvp/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
bot/
├── db/models/
│   ├── tenant.py          # Already exists: Tenant, TenantMembership, UserIdentity
│   ├── billing.py         # Already exists (unused today): Subscription, Entitlement, etc.
│   │                      #   MODIFY: add PlanFeature, FeatureUsage
│   ├── agent.py           # MODIFY: add tenant_id column
│   └── group.py           # MODIFY: map already-existing tenant_id DB column
├── services/
│   ├── workspace_service.py      # NEW: workspace CRUD + member management
│   ├── user_service.py           # MODIFY: add get_or_create_user_by_tg_id
│   ├── subscription_service.py   # EXISTING: extend for tenant-scoped checks
│   └── linked_account_service.py # MODIFY: drop AGENTS_WORKSPACE_TG_GROUP_BASE hack
├── dashboard/api/
│   ├── routers/workspace.py      # NEW: API endpoints
│   └── dependencies.py           # MODIFY: resolve users.id + active_workspace_id in get_identity
├── dashboard/frontend/
│   └── index.html                # MODIFY: add workspace switcher + invite UI
```

**Out of scope, flagged for a separate branch**: `specs/015-saas-subscription-architecture/data-model.md` (branch `feature/015-saas-subscription-architecture`) still specs a standalone `plans`/`subscriptions`/`features`/`plan_features`/`resources`/`feature_usage` schema that collides table-for-table with `billing.py`. That branch needs to be updated to build on `billing.py` + `PlanFeature` + `FeatureUsage` (introduced here) instead, before it ships.

**Structure Decision**: Follow existing patterns — new service file for workspace logic, new router file for API endpoints, minimal frontend changes integrated into the existing SPA.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Skipping full test coverage for MVP | Speed of delivery; feature is a thin layer over existing patterns | Full test coverage would double implementation time for a feature that primarily moves existing scoping boundaries |
