# Audit: Miniapp Agent Workspace Architecture

**Date**: 2026-08-19
**Scope**: `apps/miniapp-agents/`, `packages/miniapp-shared/`, relevant backend APIs
**Status**: Audit only — no code changes

---

## 1. Executive Summary

The Miniapp is **entirely agent-centric**. There is no tenant/workspace context in the frontend whatsoever. The backend has a fully functional workspace/tenant model (Tenant, TenantMembership, WorkspaceInvitation) with 12 API endpoints, but the Miniapp calls **none** of them. Agents are selected via URL routing, subscription is user-scoped (not tenant-scoped), and there is no concept of workspace members or workspace switching.

The gap between current implementation and the desired architecture (Tenant → multiple users → multiple Agents) is **large**. The backend foundation exists; the frontend is completely unaware of it.

---

## 2. Current Architecture

```
User (Telegram WebApp identity)
 │
 ▼
Miniapp (App.tsx — agent-centric, no workspace context)
 │
 ├── Authentication: Telegram initData → JWT via /api/auth/miniapp/token
 │
 ├── Agent List: fetchAgents() → GET /api/agents (user-scoped, no tenant param)
 │    ├── Agent 1 (selected via URL /accounts/{id}/...)
 │    ├── Agent 2
 │    └── Agent 3
 │
 ├── Per-Agent Features (all scoped by agentId in URL):
 │    ├── Groups: fetchAgentGroups(agentId)
 │    ├── Tasks: fetchGroupTasks(account.group_id || 196)  ← BROKEN
 │    ├── Leads: fetchAgentLeads(agentId)
 │    ├── Campaigns: listCampaigns(agentId)
 │    ├── Blacklist: fetchBlacklist(agentId)
 │    ├── Notifications: fetchAgentNotifications(agentId)
 │    ├── Analytics: fetchAgentAnalytics(agentId)
 │    ├── Safety: fetchAgentStatus(agentId)
 │    └── Jobs: fetchAgentJobs(agentId)
 │
 └── Subscription: fetchSubscriptionStatus() → GET /api/agents/subscription/status
      (user-scoped, no tenant param)
```

---

## 3. Current User Flow

1. User opens Miniapp via Telegram WebApp
2. `useMiniappSession()` authenticates via `POST /api/auth/miniapp/token` with Telegram `initData`
3. JWT stored in `sessionStorage` under `miniapp_auth_token`
4. `refresh()` calls `fetchAgents()` + `fetchSubscriptionStatus()` in parallel
5. Agents displayed on Settings page as `LinkedAccountCard` components
6. User clicks "Open workspace" on an agent → navigates to `/accounts/{id}/leads`
7. `selectedAccount` resolved from URL via `accounts.find(a => a.id === route.accountId)`
8. All child components receive `account={selectedAccount}` as prop

**No workspace context is established at any point.**

---

## 4. Current Agent Flow

### Listing
- `fetchAgents()` → `GET /api/agents` (line 31 of `agents.ts`)
- Returns all agents for the authenticated user (user-scoped via JWT)
- No workspace/tenant parameter accepted

### Selection
- URL-driven: `/accounts/{id}/{page}` (line 585 of `App.tsx`)
- Falls back to first active agent if no ID in URL (line 1098-1102)
- No dropdown or agent switcher in header — must go to Settings page

### Linking
- `linkAgent(groupId, payload)` → `POST /api/agents/link` (line 62 of `agents.ts`)
- `startAgentAuth(groupId, phoneNumber)` → `POST /api/agents/auth/start` (line 71)
- `submitAgentCode(agentId, code)` → `POST /api/agents/{agentId}/auth/code` (line 80)
- `submitAgentPassword(agentId, password)` → `POST /api/agents/{agentId}/auth/password` (line 89)
- Uses `effectiveGroupId` from session groups (line 1009 of `App.tsx`)

### Status
- `fetchAgentStatus(agentId)` → `GET /api/agents/{agentId}/status`
- Polled every 60s (line 1159-1167 of `App.tsx`)
- Shows session_state, retry_after, flood_wait_until

### Deletion
- `deleteAgent(agentId)` → `DELETE /api/agents/{agentId}`
- Confirmation modal with `setDeleteTarget(agent)` (line 997 of `App.tsx`)

### Multi-Agent Support
- **Fully supported in data model**: `accounts: Agent[]` array (line 976)
- Listed on Settings page (lines 1412-1432)
- Selected via URL routing
- Pro plan limited to 1 agent; business allows more (lines 1436-1442)
- Each agent operates independently — jobs, campaigns, leads are all agent-scoped

---

## 5. Current Tenant/Workspace Flow

### Backend (fully implemented)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/workspace` | GET | List user's workspaces |
| `/api/workspace` | POST | Create workspace |
| `/api/workspace/{id}/members` | GET | List members |
| `/api/workspace/{id}/members/{user_id}` | DELETE | Remove member |
| `/api/workspace/{id}/members/{user_id}` | PATCH | Change role |
| `/api/workspace/{id}/invitations` | POST | Create invitation |
| `/api/workspace/{id}/invitations` | GET | List invitations |
| `/api/workspace/invitations/pending` | GET | User's pending invitations |
| `/api/workspace/invitations/{token}/accept` | POST | Accept invitation |
| `/api/workspace/invitations/{token}/decline` | POST | Decline invitation |
| `/api/workspace/{id}/invitations/{token}/revoke` | POST | Revoke invitation |
| `/api/workspace/{id}/invitations/{token}/resend` | POST | Resend invitation |

### Frontend (completely absent)

- **Zero calls** to any `/api/workspace` endpoint
- **No `X-Workspace-Id` header** sent by the API client
- **No workspace state** in `App.tsx`
- **No workspace switcher UI**
- **No member management UI**
- **No invitation UI**
- The word "workspace" in the UI refers to "Open workspace" (navigating to agent's groups view), not the Tenant model

---

## 6. Current Subscription Flow

### Backend

Two parallel models exist:

1. **Legacy `SubscriptionRequest`** — keyed on `tg_user_id` (user-scoped)
   - `get_active_subscription(tg_user_id=..., bot_kind=...)` 
   - Used by: `/api/agents/subscription/status`, `/api/agents/subscription/checkout/stripe`, `/api/agents/subscription/cancel`, `/api/agents/subscription/redeem`
   - Also used by: `require_active_subscription`, `require_business_plan`, `check_plan_limit` dependencies

2. **New `Subscription` (billing.py)** — keyed on `tenant_id` (tenant-scoped)
   - `get_active_subscription_for_tenant(tenant_id)`
   - **Nothing creates `Subscription` rows yet** — the table exists but is unused in practice
   - Only consumed by `get_workspace_usage` which falls back to legacy if no tenant subscription exists

### Frontend

- `fetchSubscriptionStatus()` → `GET /api/agents/subscription/status` (line 221-222 of `agents.ts`)
- **No tenant context sent** — purely user-scoped
- Displayed as badge in header: "Pro" or "Business" (lines 1294-1311 of `App.tsx`)
- Settings page shows subscription form with redeem, checkout, cancel (lines 1382-1409)
- Pro plan limits agents to 1; business allows more (lines 1436-1442)

### Gap

Subscription is user-scoped in both backend and frontend. The tenant-scoped `Subscription` model exists but is not wired to any active endpoint. When multiple users share a workspace, each user has their own subscription — there is no shared workspace subscription.

---

## 7. Multi-Agent Support Assessment

| Question | Answer |
|----------|--------|
| Can one user link multiple Telegram accounts? | **Yes** — `fetchAgents()` returns array, link flow works per-agent |
| Can the Miniapp display multiple Agents? | **Yes** — Settings page lists all agents as cards |
| Can the user operate each Agent independently? | **Yes** — each agent has its own jobs, campaigns, leads, tasks |
| Are Agent jobs associated with a specific Agent? | **Yes** — `fetchAgentJobs(agentId)` |
| Are campaigns associated with a specific Agent? | **Yes** — `listCampaigns(agentId)` |
| Are leads associated with a specific Agent? | **Yes** — `fetchAgentLeads(agentId)` |
| Are groups associated with a specific Agent? | **Partially** — `fetchAgentGroups(agentId)` returns scraped groups, but task endpoints use `account.group_id` which is often NULL |
| Is Agent state isolated between Agents? | **Yes** — `session_state`, `flood_wait_until`, etc. are per-agent |

---

## 8. Multi-User Workspace Support Assessment

| Question | Answer |
|----------|--------|
| Can multiple users belong to the same Tenant? | **Backend: Yes** (TenantMembership). **Frontend: Unknown** — no UI exposes this |
| Can multiple users see the same Agents? | **Backend: Yes** (via `ensure_agent_admin` workspace check). **Frontend: No** — agents are user-scoped in the API |
| Can User B operate an Agent linked by User A? | **Backend: Yes** (if both are in the same workspace). **Frontend: No awareness** — no workspace context sent |
| Does the Miniapp know both users belong to the same workspace? | **No** — zero workspace awareness |
| Does the frontend enforce workspace permissions? | **No** — relies entirely on backend `ensure_agent_admin` |
| Is there any workspace/member UI? | **No** |

---

## 9. Agent Ownership Assessment

The Miniapp currently assumes:

```
User
 └── Agent (linked_by_user_id = user's tg_user_id)
```

It does **NOT** implement:

```
User
 └── Tenant (workspace)
      └── Agent (tenant_id = tenant.id)
```

Evidence:
- `serialize_agent()` returns `linked_by_user_id` but **not** `tenant_id` (`_shared.py:290-308`)
- Agent TypeScript type has **no** `tenant_id` field (`types/index.ts:164-182`)
- `fetchAgents()` calls `GET /api/agents` with no workspace parameter
- All agent operations use `agentId` in URL, resolved from user-scoped list

The backend's `ensure_agent_admin()` (`dependencies.py:494-519`) does check `agent.tenant_id → TenantMembership`, so workspace-level access control is enforced server-side. But the frontend is unaware of this.

---

## 10. API Dependency Map

### Frontend → Backend Endpoints

| Frontend Function | Backend Endpoint | Scoping |
|-------------------|-----------------|---------|
| `fetchAgents()` | `GET /api/agents` | User (JWT) |
| `linkAgent(groupId, payload)` | `POST /api/agents/link` | User (JWT) |
| `startAgentAuth(groupId, phone)` | `POST /api/agents/auth/start` | User (JWT) |
| `submitAgentCode(agentId, code)` | `POST /api/agents/{id}/auth/code` | Agent ID |
| `fetchAgentStatus(agentId)` | `GET /api/agents/{id}/status` | Agent ID |
| `fetchAgentGroups(agentId, q)` | `GET /api/agents/{id}/groups` | Agent ID |
| `fetchAgentJobs(agentId)` | `GET /api/agents/{id}/jobs` | Agent ID |
| `fetchAgentLeads(agentId)` | `GET /api/agents/{id}/leads` | Agent ID |
| `fetchAgentNotifications(agentId)` | `GET /api/agents/{id}/notifications` | Agent ID |
| `fetchAgentAnalytics(agentId)` | `GET /api/agents/{id}/analytics` | Agent ID |
| `fetchGroupTasks(groupId)` | `GET /webapp/groups/{id}/tasks` | Group ID (broken) |
| `createGroupTask(groupId, payload)` | `POST /webapp/groups/{id}/tasks` | Group ID (broken) |
| `fetchSubscriptionStatus()` | `GET /api/agents/subscription/status` | User (JWT) |
| `createSubscriptionCheckout()` | `POST /api/agents/subscription/checkout/stripe` | User (JWT) |
| `cancelSubscription()` | `POST /api/agents/subscription/cancel` | User (JWT) |
| `fetchBlacklist(agentId)` | `GET /webapp/agents/{id}/blacklist` | Agent ID |
| `listCampaigns(agentId)` | `GET /api/agents/{id}/campaigns` | Agent ID |
| `createMCPToken(name)` | `POST /api/mcp/tokens` | User (JWT) |

### Endpoints NOT called by Miniapp

| Backend Endpoint | Purpose |
|------------------|---------|
| `GET /api/workspace` | List workspaces |
| `POST /api/workspace` | Create workspace |
| `GET /api/workspace/{id}/members` | List members |
| `POST /api/workspace/{id}/invitations` | Invite member |
| All invitation lifecycle endpoints | Accept/decline/revoke/resend |
| `GET /api/usage` | Workspace usage (uses `get_workspace_context`) |

---

## 11. Frontend Components Involved

| Component | File | Agent Usage |
|-----------|------|-------------|
| `App.tsx` | `apps/miniapp-agents/src/App.tsx` | Root: loads agents, subscription, manages selection |
| `AutomationTasksSection` | `features/tasks/AutomationTasksSection.tsx` | Uses `account.group_id` (broken) and `account.id` |
| `LeadsAcquisitionSection` | `features/leads/LeadsAcquisitionSection.tsx` | Uses `account.group_id` (broken) and `account.id` |
| `BlacklistSection` | `features/blacklist/BlacklistSection.tsx` | Uses `account.id` only |
| `CampaignsPage` | `pages/CampaignsPage.tsx` | Uses `account.id` only |
| `AccountAnalyticsPage` | `pages/AccountAnalyticsPage.tsx` | Uses `account.id` only |
| `TaskActivity` | (component) | Uses `account.id` only |
| `NotificationSheet` | (component) | Uses `account.id` only |
| `SubscriptionForm` | (component) | No agent context |
| `LinkedAccountCard` | (component) | Renders agent card |

---

## 12. Backend Endpoints Used

### Agent-scoped (by `agentId` in URL)
All `/api/agents/{id}/*` endpoints — the backbone of the Miniapp.

### Group-scoped (by `groupId` in URL)
`/webapp/groups/{id}/tasks` — the task CRUD endpoints. Currently broken due to `account.group_id` being NULL.

### User-scoped (by JWT only)
`/api/agents`, `/api/agents/subscription/*`, `/api/auth/*`, `/api/mcp/tokens`

### Workspace-scoped
**None used by Miniapp.** 12 workspace endpoints exist but are not called.

---

## 13. Current Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                   Telegram WebApp                    │
│                                                      │
│  Auth: initData → JWT (POST /api/auth/miniapp/token) │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │                  App.tsx                      │   │
│  │                                               │   │
│  │  State:                                        │   │
│  │    accounts: Agent[]    ← fetchAgents()        │   │
│  │    selectedAccount      ← URL /accounts/{id}   │   │
│  │    subscription         ← fetchSubscription()  │   │
│  │                                               │   │
│  │  [NO tenant_id, NO workspace context]          │   │
│  │                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐             │   │
│  │  │  Settings    │  │  Leads      │             │   │
│  │  │  (agent list)│  │  (agent.scoped)           │   │
│  │  └─────────────┘  └─────────────┘             │   │
│  │  ┌─────────────┐  ┌─────────────┐             │   │
│  │  │  Campaigns   │  │  Tasks      │             │   │
│  │  │  (agent.scoped)│ │ (BROKEN:   │             │   │
│  │  └─────────────┘  │  group_id   │             │   │
│  │  ┌─────────────┐  │  fallback)  │             │   │
│  │  │  Blacklist   │  └─────────────┘             │   │
│  │  │  (agent.scoped)│                            │   │
│  │  └─────────────┘  ┌─────────────┐             │   │
│  │                    │  Analytics  │             │   │
│  │                    │  (agent.scoped)│            │   │
│  │                    └─────────────┘             │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│                    Backend API                       │
│                                                      │
│  Auth: JWT → user_id (TelegramWebAppIdentity)        │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ /api/agents  │  │ /webapp/    │  │ /api/agents/│ │
│  │ (user-scoped)│  │ groups/     │  │ subscription│ │
│  │              │  │ {id}/tasks  │  │ (user-scoped)│ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ /api/workspace/* (12 endpoints)                  │ │
│  │ NOT called by Miniapp                            │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ ensure_agent_admin()                             │ │
│  │ Checks: agent.tenant_id → TenantMembership       │ │
│  │ Falls back to: linked_by_user_id                 │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## 14. Gaps Between Current and Desired Architecture

| # | Gap | Current State | Desired State |
|---|-----|---------------|---------------|
| 1 | **No workspace context in Miniapp** | Zero workspace awareness | Active workspace selector, X-Workspace-Id header |
| 2 | **No workspace member UI** | No member list, no invitations | Member management, invite flow |
| 3 | **Agent list is user-scoped** | `fetchAgents()` returns user's agents only | Agents from all workspace members |
| 4 | **Subscription is user-scoped** | Each user has own subscription | Shared workspace subscription |
| 5 | **`tenant_id` not exposed** | Not in Agent type or serializer | Available in frontend for context |
| 6 | **Task endpoints use `account.group_id`** | Broken with `\|\| 196` fallback | Workspace group resolution |
| 7 | **No workspace switcher** | Single implicit workspace | Multiple workspace support |
| 8 | **`serialize_agent()` incomplete** | Missing `tenant_id`, `telegram_user_id` | Full agent serialization |
| 9 | **Two subscription models** | Legacy user-scoped + unused tenant-scoped | Unified tenant-scoped |
| 10 | **No workspace-scoped group resolution** | Groups are agent-scoped via scraped data | Groups from workspace members' admin roles |

---

## 15. Risks / Architectural Concerns

1. **Breaking change risk**: Changing `fetchAgents()` from user-scoped to workspace-scoped would change which agents appear for all users. Must be additive (e.g., new endpoint or header-based scoping).

2. **Subscription migration**: Moving from user-scoped to tenant-scoped subscriptions requires migrating existing `SubscriptionRequest` rows to `Subscription` rows, or maintaining dual-path resolution.

3. **`group_id` column deprecation**: The `Agent.group_id` column is NULL for all current agents but still used by the frontend task components. Any fix must handle this gracefully.

4. **Backend authorization is workspace-aware, frontend is not**: The `ensure_agent_admin()` check already verifies workspace membership. The frontend just doesn't know about it. Adding workspace context to the frontend should be safe since authorization is already enforced server-side.

5. **Multi-tenancy data isolation**: `Group.tenant_id` exists but is not populated. Without it, workspace-scoped group queries must go through `admin_roles → user → TenantMembership` joins, which is less efficient.

---

## 16. Files Inspected

### Frontend
- `apps/miniapp-agents/src/App.tsx` (3312 lines)
- `apps/miniapp-agents/src/features/tasks/AutomationTasksSection.tsx` (456 lines)
- `apps/miniapp-agents/src/features/leads/LeadsAcquisitionSection.tsx` (313 lines)
- `apps/miniapp-agents/src/features/blacklist/BlacklistSection.tsx`
- `apps/miniapp-agents/src/pages/CampaignsPage.tsx`
- `apps/miniapp-agents/src/i18n/locales/en.json`
- `packages/miniapp-shared/src/api/agents.ts` (437 lines)
- `packages/miniapp-shared/src/api/base.ts`
- `packages/miniapp-shared/src/types/index.ts`

### Backend
- `bot/dashboard/api/routers/agents.py`
- `bot/dashboard/api/routers/admin_automation.py`
- `bot/dashboard/api/routers/subscription.py`
- `bot/dashboard/api/routers/workspace.py`
- `bot/dashboard/api/routers/_shared.py`
- `bot/dashboard/api/dependencies.py`
- `bot/services/task_service.py`
- `bot/services/permission_service.py`
- `bot/services/subscription_service.py`
- `bot/services/workspace_service.py`
- `bot/agents/account_group_membership_service.py`
- `bot/db/models/agent.py`
- `bot/db/models/group.py`
- `bot/db/models/messaging.py` (Tenant model)
- `bot/db/models/tenant.py` (TenantMembership model)

---

## 17. Conclusion

**Does the current Miniapp already implement Tenant → multiple users → multiple Agents, or is it still primarily an Agent-centric application?**

**It is still primarily an Agent-centric application.** The Miniapp has zero workspace/tenant awareness. The backend has a complete workspace model with 12 endpoints, but the Miniapp calls none of them. Agents are scoped by user identity (JWT), not by workspace membership. Subscription is user-scoped, not workspace-scoped. There is no workspace switcher, no member management, and no workspace context in any API call.

The backend authorization layer (`ensure_agent_admin`) does enforce workspace membership for agent access, so the foundation is solid. But the frontend needs significant work to become workspace-aware: adding workspace context, exposing `tenant_id`, switching from user-scoped to workspace-scoped data loading, and implementing workspace management UI.

**The current implementation gap is: Backend = 80% ready, Frontend = 0% ready.**
