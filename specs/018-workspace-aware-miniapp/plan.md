# Implementation Plan: Make Miniapp Agent Workspace-Aware

**Branch**: `feature/018-workspace-aware-miniapp`
**Spec**: `specs/018-workspace-aware-miniapp/spec.md`
**Audit**: `specs/017-fix-hardcoded-group-id-fallback/audit.md`

## Architecture Decision Records

### ADR-001: Centralized Workspace Context via API Client

**Decision**: Add workspace context to the shared API client (`packages/miniapp-shared/src/api/base.ts`) so `X-Workspace-Id` is injected on every request automatically.

**Rationale**: The Miniapp has ~40+ API call sites. Adding the header manually to each would be error-prone and violate DRY. The existing `withAppBoundary()` pattern in `buildHeaders()` provides a proven mechanism for centralized header injection.

**Implementation**:
1. Add a module-level `activeWorkspaceId: number | null` variable in `base.ts`
2. Export `setWorkspaceContext(tenantId: number)` and `getWorkspaceContext(): number | null`
3. In `buildHeaders()`, if `activeWorkspaceId` is set, add `X-Workspace-Id: {activeWorkspaceId}`
4. All existing API calls automatically get the header — no per-call changes needed

### ADR-002: Workspace Resolution from Backend, Not Frontend

**Decision**: The backend's `get_workspace_context` already resolves workspace from `X-Workspace-Id` header (or defaults to owner workspace). The frontend's job is to:
1. Fetch the list of workspaces on load (`GET /api/workspace`)
2. Select the active one (default: owner workspace)
3. Send it as `X-Workspace-Id` on all subsequent requests

**Rationale**: The backend has sophisticated resolution logic (auto-create, fallback, membership check). Reimplementing this in the frontend would be redundant and risky.

### ADR-003: Extend `/api/auth/me` with Workspace Info

**Decision**: Extend `build_identity_profile()` to include workspace context in the auth response.

**Rationale**: The Miniapp already calls `GET /api/auth/me` on load via `useMiniappSession`. Adding workspace info here avoids an extra API call and keeps the session hook as the single source of truth.

**Alternative considered**: Call `GET /api/workspace` separately. Rejected because it adds a sequential dependency (auth → workspace → agents) vs. parallel loading.

### ADR-004: Task/Group Problem Deferred

**Decision**: The `account.group_id` / task endpoint problem is documented but NOT fixed in this migration.

**Rationale**: The correct fix requires understanding the domain relationship between Tenant, Agent, Group, and Task Assignment. Mixing this into the workspace migration increases risk and scope. A separate spec will address it.

## Implementation Phases

### Phase 1: Backend Foundation

**Goal**: Expose workspace context to the frontend.

1. Add `tenant_id` to `serialize_agent()` in `_shared.py`
2. Extend `build_identity_profile()` to include `workspace: { id, name, role, subscription }`
3. Add `workspace` field to `MiniappIdentity` TypeScript type
4. Add `tenant_id` to `Agent` TypeScript type

### Phase 2: API Client Workspace Context

**Goal**: Centralize `X-Workspace-Id` injection in the shared API layer.

1. Add `setWorkspaceContext()` / `getWorkspaceContext()` to `base.ts`
2. Modify `buildHeaders()` to inject `X-Workspace-Id` when set
3. Export workspace context functions from shared package

### Phase 3: Session + Workspace Loading

**Goal**: Load workspace on app init, establish active workspace.

1. Extend `useMiniappSession` to fetch workspace list and set active workspace
2. Call `setWorkspaceContext(tenantId)` when workspace is resolved
3. Store active workspace in component state

### Phase 4: Agent Listing

**Goal**: Ensure agent list is workspace-scoped.

1. `fetchAgents()` already sends auth token — backend resolves tenant
2. Verify agents returned match active workspace
3. No code changes needed if backend scoping is correct

### Phase 5: Subscription Alignment

**Goal**: Present subscription as workspace resource.

1. Use workspace subscription from `GET /api/workspace` response
2. Update `SubscriptionStatusInfo` type to include workspace context
3. Display "Workspace: {name}" alongside subscription badge

### Phase 6: Workspace Switching Foundation

**Goal**: Structure for multi-workspace support.

1. If user has multiple workspaces, show workspace selector
2. On workspace change: clear agents, reload, update context
3. Single-workspace users see no change

### Phase 7: Stale State Prevention

**Goal**: Prevent data leakage across workspaces.

1. Clear agent state on workspace change
2. Clear subscription state on workspace change
3. Clear group/task state on workspace change
4. Reset selected agent on workspace change

## Files to Modify

### Backend
| File | Change |
|------|--------|
| `bot/dashboard/api/routers/_shared.py` | Add `tenant_id` to `serialize_agent()` |
| `bot/dashboard/api/dependencies.py` | Extend `build_identity_profile()` with workspace info |

### Shared Package
| File | Change |
|------|--------|
| `packages/miniapp-shared/src/api/base.ts` | Add `setWorkspaceContext()`, modify `buildHeaders()` |
| `packages/miniapp-shared/src/types/index.ts` | Add `tenant_id` to Agent, add Workspace type, extend MiniappIdentity |
| `packages/miniapp-shared/src/index.ts` | Export workspace context functions |

### Miniapp
| File | Change |
|------|--------|
| `apps/miniapp-agents/src/App.tsx` | Load workspace, manage workspace state, pass to children |
| `apps/miniapp-agents/src/features/tasks/AutomationTasksSection.tsx` | Document group_id problem (deferred fix) |
| `apps/miniapp-agents/src/features/leads/LeadsAcquisitionSection.tsx` | Document group_id problem (deferred fix) |

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking existing single-workspace users | Backend auto-creates workspaces. `X-Workspace-Id` is optional — backend defaults to owner workspace |
| `X-Workspace-Id` header on non-workspace endpoints | Backend ignores unknown headers. Existing endpoints don't read it |
| Multiple workspaces per user | Selector UI only shown when >1 workspace exists |
| Stale agent data after workspace switch | Explicit state clearing on workspace change |
| Task/group_id breakage | Deferred to separate spec. Existing behavior preserved |

## Verification Plan

1. **Single workspace user**: App loads, agents shown, operations work — no visible change
2. **Multi-workspace user**: Workspace selector appears, switching changes agent list
3. **Multi-user same workspace**: Both users see same agents
4. **Cross-workspace isolation**: User cannot see agents from other workspaces
5. **Subscription**: Workspace subscription displayed correctly
6. **Agent operations**: Jobs, campaigns, leads, notifications all work
7. **Backend tests**: Existing tests pass
8. **Frontend build**: No TypeScript errors
