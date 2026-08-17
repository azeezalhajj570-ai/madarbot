# Implementation Plan: Workspace Member Invitations

**Branch**: `016-workspace-member-invitations` | **Date**: 2026-08-17 | **Spec**: `specs/016-workspace-member-invitations/spec.md`

**Input**: Feature specification from `specs/016-workspace-member-invitations/spec.md`

## Summary

Replace the direct-add "invite" operation (`WorkspaceService.invite_member()`) with a proper invitation lifecycle: create → pending → accept/decline/expired/revoked. Add a `WorkspaceInvitation` table, invitation lifecycle methods to `WorkspaceService`, new API endpoints, notification on creation, audit logging, and frontend updates to the Members page.

## Technical Context

**Language/Version**: Python 3.11+

**Primary Dependencies**: FastAPI, SQLAlchemy async, Pydantic

**Storage**: PostgreSQL 16 (via asyncpg) + Redis 7

**Testing**: pytest + pytest-asyncio

**Target Platform**: Linux server (Docker)

**Project Type**: Web service (FastAPI backend + React dashboard)

**Constraints**: Must not break existing workspace memberships or APIs; must reuse existing authorization patterns (`WorkspaceContext`, `get_workspace_context()`); must follow existing code conventions.

## Constitution Check

| Gate | Status |
|------|--------|
| I. Security & Secrets Management | ✅ Token-based routes, no secrets exposed |
| II. Code Quality — ruff/mypy must pass | ✅ Enforce on new code |
| III. Testing Standards — tests required | ✅ Backend tests for all operations |
| IV. UX Consistency — dashboard patterns must match | ✅ Follow existing MembersPage pattern |
| V. Performance — N+1 queries forbidden | ✅ Invitation queries are simple; reuse existing patterns |
| VI. Async-First — all I/O must be async | ✅ All new code is async |
| VII. Containerized Infrastructure | ✅ No infra changes needed |
| VIII. Structured Observability | ✅ AuditLog for all lifecycle events |

## Project Structure

### Source Code Changes

```
bot/
├── db/models/
│   └── workspace_invitation.py    # NEW: WorkspaceInvitation model
│   └── __init__.py                # MODIFY: add import
├── services/
│   └── workspace_service.py       # MODIFY: add invitation lifecycle methods
├── dashboard/api/
│   └── routers/workspace.py       # MODIFY: add invitation endpoints, remove old invite
├── dashboard/frontend/
│   └── index.html                 # (no changes — frontend is React)

dashboard/src/
├── pages/
│   └── MembersPage.tsx            # MODIFY: add invitation sections
├── lib/
│   ├── api.ts                     # MODIFY: add invitation API functions
│   ├── types.ts                   # MODIFY: add invitation types
│   └── i18n.tsx                   # MODIFY: add invitation translation keys

alembic/versions/
└── YYYYMMDD_NNN_add_workspace_invitations.py  # NEW: migration

specs/016-workspace-member-invitations/
├── spec.md                        # Feature specification
├── plan.md                        # This file
├── research.md                    # Research decisions
├── data-model.md                  # Data model
├── contracts/api.md               # API contracts
├── clarify.md                     # Clarification decisions
├── quickstart.md                  # Quickstart guide
└── tasks.md                       # Task breakdown
```

## Implementation Phases

### Phase 1: Database Model + Migration

**Goal**: Create the `WorkspaceInvitation` table.

**Files to create/modify**:
- `bot/db/models/workspace_invitation.py` (new)
- `bot/db/models/__init__.py` (add import)
- `alembic/versions/YYYYMMDD_NNN_add_workspace_invitations.py` (new)

**Details**:
1. Create `WorkspaceInvitation` ORM model with all columns, indexes, and constraints.
2. Register the model in `bot/db/models/__init__.py`.
3. Generate Alembic migration:
   - Create `workspace_invitations` table
   - Add FKs: `tenant_id → tenants.id`, `invited_user_id → users.id`, `inviter_user_id → users.id`
   - Add B-tree indexes
   - Add partial unique index `uq_invitation_pending_per_user`
   - Add UNIQUE index on `token`

**Verification**: `alembic upgrade head` succeeds; existing tests pass.

### Phase 2: Invitation Service Methods

**Goal**: Add invitation lifecycle logic to `WorkspaceService`.

**Files to modify**:
- `bot/services/workspace_service.py`

**New methods**:
1. `create_invitation(tenant_id, inviter_user_id, identifier, role)` — validates role, checks not already member, checks no pending duplicate, generates UUID4 token, sets `expires_at`, creates record, sends notification, logs audit.
2. `list_invitations(tenant_id, status=None)` — lists all invitations for a workspace (admin/owner view).
3. `list_user_pending_invitations(user_id)` — lists pending invitations for a user across all workspaces (invited user view).
4. `accept_invitation(token, user_id)` — verifies ownership, checks pending + not expired, creates `TenantMembership` + marks accepted in a transaction.
5. `decline_invitation(token, user_id)` — verifies ownership, marks declined (idempotent).
6. `revoke_invitation(token, tenant_id)` — verifies admin/owner role, marks revoked.
7. `resend_invitation(token, tenant_id)` — verifies admin/owner role, extends `expires_at`, sends new notification.
8. `_get_invitation_by_token(token)` — internal helper.
9. `_revoke_user_pending_invitations(tenant_id, user_id)` — auto-revoke on member removal.

**Modify existing methods**:
- `remove_member()` — add call to `_revoke_user_pending_invitations()` after membership deactivation.

**Verification**: Unit tests for all new methods.

### Phase 3: Audit Logging

**Goal**: Record invitation lifecycle events in `AuditLog`.

**Files to modify**:
- `bot/services/workspace_service.py`

**Implementation**:
- Add `_audit_invitation()` helper method.
- Call it from `create_invitation`, `accept_invitation`, `decline_invitation`, `revoke_invitation`, `resend_invitation`.
- Use `action="invitation.{event}"`, `target_type="workspace_invitation"`, `target_id=str(invitation.id)`.

**Verification**: Audit log entries are created for each lifecycle event.

### Phase 4: Notifications

**Goal**: Notify invited users on invitation creation and resend.

**Files to modify**:
- `bot/services/workspace_service.py`

**Implementation**:
1. **In-app notification**: Create `AgentNotification` with `kind="workspace_invitation"`, `agent_id=None`, `group_id=None`. Payload includes `invitation_token`, `workspace_id`, `workspace_name`, `role`, `inviter_name`.
2. **Telegram DM** (best-effort): If invited user has `tg_user_id`, try `bot.send_message(tg_user_id, text)` via `BotPool.get()`. Catch and log exceptions.
3. Call notification logic from `create_invitation()` and `resend_invitation()`.

**Verification**: Notification record created; Telegram DM sent (if bot available).

### Phase 5: API Router

**Goal**: Expose invitation endpoints and remove old invite endpoint.

**Files to modify**:
- `bot/dashboard/api/routers/workspace.py`

**New endpoints**:
1. `POST /api/workspace/{workspace_id}/invitations` — create invitation (owner/admin)
2. `GET /api/workspace/{workspace_id}/invitations` — list invitations for workspace (owner/admin)
3. `GET /api/workspace/invitations/pending` — list own pending invitations (any user)
4. `POST /api/workspace/invitations/{token}/accept` — accept invitation (invited user)
5. `POST /api/workspace/invitations/{token}/decline` — decline invitation (invited user)
6. `POST /api/workspace/{workspace_id}/invitations/{token}/revoke` — revoke (owner/admin)
7. `POST /api/workspace/{workspace_id}/invitations/{token}/resend` — resend (owner/admin)

**Remove**: `POST /api/workspace/{workspace_id}/invite` (old direct-add endpoint)

**Request models**:
```python
class CreateInvitationRequest(BaseModel):
    identifier: str
    role: str = "member"
```

**Auth patterns**:
- Workspace-scoped endpoints use `WorkspaceContext` (existing dependency).
- User-scoped endpoints (`/invitations/pending`, `/invitations/{token}/accept`, `/invitations/{token}/decline`) use `get_identity()` directly.

**Verification**: All endpoints return correct responses; old endpoint returns 404.

### Phase 6: Frontend — API Client + Types

**Goal**: Add TypeScript types and API functions for invitations.

**Files to modify**:
- `dashboard/src/lib/types.ts` — add `WorkspaceInvitation`, `PendingInvitation` types
- `dashboard/src/lib/api.ts` — add `fetchWorkspaceInvitations()`, `createWorkspaceInvitation()`, `fetchPendingInvitations()`, `acceptInvitation()`, `declineInvitation()`, `revokeInvitation()`, `resendInvitation()`

**Verification**: TypeScript compiles; API functions match backend contracts.

### Phase 7: Frontend — MembersPage Updates

**Goal**: Update Members page with invitation management UI.

**Files to modify**:
- `dashboard/src/pages/MembersPage.tsx`

**Changes**:
1. Update invite dialog to call `createWorkspaceInvitation()` instead of `inviteTeamWorkspaceMember()`.
2. Add "My Pending Invitations" card below members table (for the current user).
3. Add "Sent Invitations" card within workspace context (for owners/admins).
4. Add revoke/resend buttons for sent invitations.
5. Add accept/decline buttons for pending invitations.

**Verification**: UI renders correctly; mutations work with cache invalidation.

### Phase 8: i18n

**Goal**: Add English and Arabic translations for all new UI strings.

**Files to modify**:
- `dashboard/src/lib/i18n.tsx`

**New keys** (see quickstart.md for full list).

**Verification**: Both EN and AR render correctly; RTL works for AR.

### Phase 9: Tests

**Goal**: Backend tests for all invitation operations.

**Files to create**:
- `tests/test_workspace_invitations.py`

**Test cases** (see spec.md Testing Requirements section).

**Verification**: `pytest tests/test_workspace_invitations.py -v` passes; `pytest -x -q` (full suite) passes.

### Phase 10: Lint + Type Check

**Goal**: Ensure code quality.

**Commands**:
```bash
ruff check bot/
mypy bot/
```

**Verification**: No new errors.

## Dependency Graph

```
Phase 1 (Model + Migration)
  └─→ Phase 2 (Service Methods)
       ├─→ Phase 3 (Audit Logging)
       ├─→ Phase 4 (Notifications)
       └─→ Phase 5 (API Router)
            └─→ Phase 6 (Frontend Types + API)
                 └─→ Phase 7 (MembersPage UI)
                      └─→ Phase 8 (i18n)
                           └─→ Phase 9 (Tests)
                                └─→ Phase 10 (Lint)
```

Phases 3 and 4 can be done in parallel (both modify `workspace_service.py` but in different methods).
Phase 9 (tests) can be started early and run incrementally after Phase 2.

## Complexity Tracking

No constitution violations requiring justification.
