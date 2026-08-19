# Feature Specification: Make Miniapp Agent Workspace-Aware

**Feature Branch**: `feature/018-workspace-aware-miniapp`

**Created**: 2026-08-19

**Status**: Draft

**Reference**: `specs/017-fix-hardcoded-group-id-fallback/audit.md`

## Executive Summary

The Miniapp (`apps/miniapp-agents`) is currently agent-centric with zero workspace/tenant awareness. The backend has a fully functional workspace model (Tenant, TenantMembership, WorkspaceInvitation) with 12 API endpoints and workspace-scoped authorization, but the Miniapp calls none of them.

This specification defines the migration from user-scoped to workspace-scoped architecture, establishing Tenant as the Workspace/Subscription boundary.

## Current State (Verified)

| Dimension | Current |
|-----------|---------|
| Agent listing | `GET /api/agents` — resolves tenant server-side via `resolve_actor_tenant_id(actor_user_id)`, but frontend has no workspace context |
| Agent serializer | `serialize_agent()` returns `id`, `group_id`, `linked_by_user_id` — **no `tenant_id`** |
| Agent TypeScript type | No `tenant_id` field |
| Subscription | User-scoped (`SubscriptionRequest.tg_user_id`), displayed per-user |
| `/api/auth/me` | Returns user info, groups, subscription — **no workspace info** |
| `useMiniappSession` | Returns `identity` with `user`, `groups`, `subscription` — **no workspace** |
| API client headers | `Authorization`, `X-App-Boundary`, `X-Telegram-Init-Data` — **no `X-Workspace-Id`** |
| React Context | **None** — all state in `App()`, props drilled to children |
| Backend workspace APIs | 12 endpoints in `/api/workspace/*` — **not called by Miniapp** |
| Backend authorization | `ensure_agent_admin()` checks `agent.tenant_id → TenantMembership` — **already workspace-aware** |
| Backend agent listing | `list_agents()` filters by `Agent.tenant_id == tenant_id` — **already workspace-aware** |

## Target Architecture

```
User
  ↓
Miniapp Session (auth)
  ↓
Workspace Context (active tenant_id)
  ↓
┌─────────────────────────────────┐
│         Workspace/Tenant         │
│  ├── Subscription (workspace)    │
│  ├── Agents (workspace-scoped)   │
│  ├── Groups (workspace-scoped)   │
│  └── Members (workspace-scoped)  │
└─────────────────────────────────┘
  ↓
Selected Agent
  ↓
Agent-specific operations (jobs, campaigns, leads, etc.)
```

## Functional Requirements

### FR-001: Workspace Context (P0)

The Miniapp MUST have an explicit active Workspace/Tenant context.

**Current**: No workspace context exists.
**Target**: Active workspace with `tenant_id`, `name`, `role`, `subscription`.

The workspace context must be:
- Established on app load (from `/api/workspace` endpoint)
- Available to the API client centrally
- Stored in application state
- Exposed to components that need it

### FR-002: Backend Workspace API Integration (P0)

Use existing backend endpoints — do NOT create duplicates.

**Existing endpoints to integrate:**

| Endpoint | Purpose |
|----------|---------|
| `GET /api/workspace` | List user's workspaces (auto-creates one if none) |
| `POST /api/workspace` | Create new workspace |
| `GET /api/workspace/{id}/members` | List workspace members |
| `POST /api/workspace/{id}/invitations` | Invite member |
| Invitation lifecycle | Accept/decline/revoke/resend |

**Resolution**: `get_workspace_context` (dependencies.py:274-302) resolves workspace from:
1. `X-Workspace-Id` header (if provided)
2. Otherwise: owner workspace or first membership
3. If no memberships: auto-creates via `get_or_create_user_workspace`

### FR-003: Centralized API Client Workspace Context (P0)

The API client MUST inject `X-Workspace-Id` centrally — not per-call.

**Current**: `buildHeaders()` in `base.ts` sends `Authorization`, `X-App-Boundary`.
**Target**: `buildHeaders()` also sends `X-Workspace-Id: {activeWorkspaceId}`.

Implementation: Add a `setWorkspaceContext(tenantId)` function to the shared API layer that stores the active workspace ID. `buildHeaders()` reads it and injects the header on every request.

### FR-004: Agent Serializer + Type Update (P0)

Expose `tenant_id` in the Agent serialization.

**Backend change**: Add `tenant_id` to `serialize_agent()` in `_shared.py`.
**Frontend change**: Add `tenant_id` to Agent interface in `types/index.ts`.

Do NOT expose `linked_by_user_id` to the frontend (it's internal provenance).

### FR-005: Workspace-Scoped Agent Listing (P0)

**Current**: `fetchAgents()` calls `GET /api/agents` with no workspace context.
**Target**: `fetchAgents()` sends `X-Workspace-Id` header (via centralized mechanism).

The backend already scopes by tenant server-side. The header ensures explicit workspace selection when a user has multiple workspaces.

### FR-006: Workspace-Scoped Subscription (P0)

**Current**: `fetchSubscriptionStatus()` calls `GET /api/agents/subscription/status` (user-scoped).
**Target**: Subscription status resolved from workspace context.

The workspace listing endpoint (`GET /api/workspace`) already returns `subscription` per workspace. Use this as the primary subscription source. The user-scoped endpoint becomes a fallback.

### FR-007: Workspace Context on Auth (P0)

**Current**: `/api/auth/me` returns user info, groups, subscription — no workspace.
**Target**: `/api/auth/me` also returns workspace context, OR the Miniapp fetches workspace separately on load.

Option A (preferred): Extend `build_identity_profile` to include `workspace: { id, name, role, subscription }`.
Option B: Miniapp calls `GET /api/workspace` separately after auth.

### FR-008: Multiple Agents per Workspace (P0)

Preserve existing multi-agent support. One workspace supports multiple agents.

**Current**: Already works in backend (`list_agents` filters by `tenant_id`).
**Target**: Frontend displays all workspace agents, not just user-linked agents.

No changes needed to agent CRUD, jobs, campaigns, leads, etc. — they already use `agentId` which is workspace-scoped server-side.

### FR-009: Selected Agent Remains Operational Context (P1)

Architecture: Workspace → Agent list → Selected Agent → Agent operations.

Agent-specific operations continue using `/api/agents/{agent_id}/...`. Authorization is already workspace-checked via `ensure_agent_admin()`.

### FR-010: Workspace Member Awareness (P1)

Expose workspace membership info to the Miniapp.

**Minimum**: Current user's role, whether they can manage agents.
**UI**: Display workspace name and role in header/settings. Full member management UI is optional for initial implementation.

### FR-011: Workspace Switching Foundation (P2)

Structure the context to support workspace switching without requiring it in v1.

**If user has multiple workspaces**: Show workspace selector.
**If user has one workspace**: Auto-select, no UI needed.

The `get_workspace_context` backend already supports this via `X-Workspace-Id` header.

### FR-012: Tenant Isolation (P0)

When active workspace changes:
1. Clear selected agent
2. Reload agents (new workspace)
3. Reload subscription
4. Reload groups
5. Prevent stale data display

### FR-013: Frontend Role-Based Visibility (P2)

Use workspace role for UI decisions (e.g., hide admin-only features for viewers).

Backend authorization remains authoritative. Frontend checks are for UX only.

### FR-014: Group Scope Investigation (P1)

Investigate the `account.group_id` / task endpoint problem separately.

**Findings:**
- `Agent.group_id` is NULL for all current agents (workspace model)
- Task endpoints use `account.group_id` as routing key
- `fetchAgentGroups()` returns scraped groups (scraped_groups.id), not groups table IDs
- Task API needs `groups.id` (internal PK)
- No workspace-to-groups resolution exists

**Decision**: This is a separate work item. The workspace migration should NOT introduce a hardcoded group_id fix. Document the correct domain relationship and fix in a follow-up.

### FR-015: Backward Compatibility (P0)

Single-workspace users continue working without configuration. Backend auto-creates workspaces via `get_or_create_user_workspace`. No manual tenant ID management required.

## Non-Goals

- Do NOT rewrite Agent system, Telegram auth, campaigns, leads, scraping, workers
- Do NOT create new Tenant/Subscription models (they exist)
- Do NOT create one workspace per Agent
- Do NOT remove `linked_by_user_id` or `group_id`
- Do NOT implement unrelated UI redesign
- Do NOT mix the task/group_id fix into this migration

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC-001 | Miniapp loads with explicit active workspace |
| AC-002 | Agents displayed belong to active workspace |
| AC-003 | Multiple agents visible per workspace |
| AC-004 | Agent operations (jobs, campaigns, leads) continue working |
| AC-005 | Two users in same workspace see same agents |
| AC-006 | User cannot see agents from other workspaces |
| AC-007 | Subscription associated with workspace in UX |
| AC-008 | `X-Workspace-Id` injected centrally by API client |
| AC-009 | Workspace change clears stale data |
| AC-010 | Existing single-workspace users work without changes |
| AC-011 | Backend workspace APIs used (no duplicates) |
| AC-012 | `tenant_id` exposed in Agent type/serializer |
| AC-013 | Task/group_id problem documented separately |
| AC-014 | No hardcoded group IDs introduced |
