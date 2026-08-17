# Tasks: Workspace Member Invitations

**Branch**: `016-workspace-member-invitations`
**Spec**: `specs/016-workspace-member-invitations/spec.md`
**Plan**: `specs/016-workspace-member-invitations/plan.md`

## Phase 1: Database Model + Migration

### Task 1.1: Create WorkspaceInvitation model
- Create `bot/db/models/workspace_invitation.py`
- Define `WorkspaceInvitation` ORM model with all columns:
  - `id` (Integer PK)
  - `tenant_id` (FK → tenants.id, NOT NULL, CASCADE)
  - `invited_user_id` (FK → users.id, NOT NULL, CASCADE)
  - `inviter_user_id` (FK → users.id, NOT NULL, CASCADE)
  - `role` (String(32), NOT NULL)
  - `status` (String(20), NOT NULL, default='pending')
  - `token` (String(64), NOT NULL, UNIQUE)
  - `created_at`, `expires_at`, `accepted_at`, `declined_at`, `revoked_at`, `updated_at`
- Add indexes on all key columns
- Add partial unique index `uq_invitation_pending_per_user` via `Index(..., postgresql_where="status = 'pending'")`
- Add `__tablename__ = "workspace_invitations"`

**File**: `bot/db/models/workspace_invitation.py` (new)
**Verify**: Model imports correctly; `Base.metadata.create_all` would include the table

### Task 1.2: Register model in __init__.py
- Add `WorkspaceInvitation` import to `bot/db/models/__init__.py`

**File**: `bot/db/models/__init__.py` (modify)
**Verify**: `from bot.db.models import WorkspaceInvitation` works

### Task 1.3: Generate Alembic migration
- Create migration file `alembic/versions/YYYYMMDD_NNN_add_workspace_invitations.py`
- Operations:
  - `op.create_table('workspace_invitations', ...)` with all columns
  - `op.create_index(...)` for each B-tree index
  - `op.create_index(..., postgresql_where=...)` for partial unique index
- No backfill needed
- Downgrade: drop table

**File**: `alembic/versions/YYYYMMDD_NNN_add_workspace_invitations.py` (new)
**Verify**: `alembic upgrade head` succeeds; `alembic downgrade -1` succeeds

## Phase 2: Invitation Service Methods

### Task 2.1: Add create_invitation method
- Add `create_invitation(self, *, tenant_id, inviter_user_id, identifier, role)` to `WorkspaceService`
- Validate role is in `{"admin", "member", "viewer"}` (not "owner")
- Check inviter has owner/admin role via `get_membership()`
- Resolve target user via `_resolve_identifier()`
- Check target is not already a member via `get_membership()`
- Check no existing pending invitation for same (tenant_id, invited_user_id)
- Generate UUID4 token: `secrets.token_hex(16)` or `uuid.uuid4().hex`
- Set `expires_at = datetime.utcnow() + timedelta(days=7)`
- Create and persist `WorkspaceInvitation` record
- Return the invitation

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Unit test: owner creates invitation → record exists with correct fields

### Task 2.2: Add list_invitations method
- Add `list_invitations(self, tenant_id, status=None)` to `WorkspaceService`
- Query `WorkspaceInvitation` where `tenant_id` matches
- Optionally filter by `status`
- Join with `User` for invited_user and inviter_user details
- Return list of dicts with all fields except token (admin view)

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Unit test: list invitations returns correct records

### Task 2.3: Add list_user_pending_invitations method
- Add `list_user_pending_invitations(self, user_id)` to `WorkspaceService`
- Query `WorkspaceInvitation` where `invited_user_id == user_id` AND `status == 'pending'`
- Join with `Tenant` for workspace name
- Join with `User` for inviter details
- Return list of dicts including token (for accept/decline)

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Unit test: user sees only their own pending invitations

### Task 2.4: Add accept_invitation method
- Add `accept_invitation(self, *, token, user_id)` to `WorkspaceService`
- Look up invitation by token
- Verify `invited_user_id == user_id` (security check)
- Verify `status == 'pending'`
- Verify `expires_at > datetime.utcnow()`
- In a transaction:
  - Create `TenantMembership(tenant_id=..., user_id=..., role=invitation.role)`
  - Set `invitation.status = 'accepted'`, `invitation.accepted_at = datetime.utcnow()`
- Commit
- Return the new membership

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Unit test: correct user accepts → membership created; wrong user rejects

### Task 2.5: Add decline_invitation method
- Add `decline_invitation(self, *, token, user_id)` to `WorkspaceService`
- Look up invitation by token
- Verify `invited_user_id == user_id`
- If `status == 'pending'`: set `status = 'declined'`, `declined_at = now()`
- If already declined/accepted/etc: return gracefully (idempotent)
- Commit

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Unit test: decline works; repeated decline is idempotent

### Task 2.6: Add revoke_invitation method
- Add `revoke_invitation(self, *, token, tenant_id, actor_user_id)` to `WorkspaceService`
- Look up invitation by token + tenant_id
- Verify actor has owner/admin role
- If `status == 'pending'`: set `status = 'revoked'`, `revoked_at = now()`
- Commit

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Unit test: admin revokes; member cannot revoke

### Task 2.7: Add resend_invitation method
- Add `resend_invitation(self, *, token, tenant_id, actor_user_id)` to `WorkspaceService`
- Look up invitation by token + tenant_id
- Verify actor has owner/admin role
- Verify `status == 'pending'`
- Set `expires_at = datetime.utcnow() + timedelta(days=7)`
- Send notification (reuse notification logic from create_invitation)
- Commit

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Unit test: resend extends expiration

### Task 2.8: Add _get_invitation_by_token helper
- Add `_get_invitation_by_token(self, token)` to `WorkspaceService`
- Query `WorkspaceInvitation` where `token == token`
- Return the invitation or None

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Used by other methods

### Task 2.9: Add auto-revoke on member removal
- Modify `remove_member()` in `WorkspaceService`
- After setting `target_membership.is_active = False`, call `_revoke_user_pending_invitations(tenant_id, target_user_id)`
- Add `_revoke_user_pending_invitations(self, tenant_id, user_id)` method:
  - Query all pending invitations for (tenant_id, user_id)
  - Set each to `status = 'revoked'`, `revoked_at = now()`
  - Do NOT commit (caller commits)

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Unit test: remove member → pending invitations revoked

### Task 2.10: Remove old invite_member method
- Remove `invite_member()` from `WorkspaceService`
- Remove `ROLES_THAT_CAN_INVITE` constant (replaced by same logic in `create_invitation`)
- Keep `ROLES_THAT_CAN_MANAGE_MEMBERS` (used by `remove_member`)

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Old method no longer exists; all callers updated

## Phase 3: Audit Logging

### Task 3.1: Add audit helper method
- Add `_audit_invitation(self, *, tenant_id, actor_user_id, action, invitation_id)` to `WorkspaceService`
- Create `AuditLog` record with:
  - `tenant_id`
  - `actor_type = "user"`
  - `actor_id = str(actor_user_id)`
  - `action = f"invitation.{action}"`
  - `target_type = "workspace_invitation"`
  - `target_id = str(invitation_id)`
- Add to session (do NOT commit — caller commits)

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Audit record created on each lifecycle event

### Task 3.2: Wire audit calls into invitation methods
- Call `_audit_invitation` from:
  - `create_invitation()` → `action="created"`
  - `accept_invitation()` → `action="accepted"`
  - `decline_invitation()` → `action="declined"`
  - `revoke_invitation()` → `action="revoked"`
  - `resend_invitation()` → `action="resent"`

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Each operation creates an audit log entry

## Phase 4: Notifications

### Task 4.1: Add in-app notification on invitation creation
- In `create_invitation()`, after creating the invitation:
  - Create `AgentNotification` with:
    - `agent_id = None`
    - `group_id = None`
    - `kind = "workspace_invitation"`
    - `title = "Workspace Invitation"`
    - `body = f"You've been invited to {workspace_name} as {role} by {inviter_name}"`
    - `payload = {"invitation_token": token, "workspace_id": tenant_id, "workspace_name": name, "role": role, "inviter_name": inviter_name}`
  - Need to fetch tenant name and inviter name for the notification body

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: `AgentNotification` record created with correct fields

### Task 4.2: Add Telegram DM notification (best-effort)
- In `create_invitation()`, after creating in-app notification:
  - If invited user has `tg_user_id`:
    - Try `bot.send_message(tg_user_id, text)` via `BotPool.get()`
    - Text: "You've been invited to {workspace_name} as {role} by {inviter_name}. Open the dashboard to accept or decline."
    - Catch and log exceptions (user may not have started the bot)
  - Import `BotPool` from `bot.utils.bot_pool`

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Telegram DM sent when bot is available; graceful failure when not

### Task 4.3: Add notification on resend
- In `resend_invitation()`, reuse the same notification logic from `create_invitation()`

**File**: `bot/services/workspace_service.py` (modify)
**Verify**: Resend sends new notification

## Phase 5: API Router

### Task 5.1: Add CreateInvitationRequest model
- Add Pydantic model:
  ```python
  class CreateInvitationRequest(BaseModel):
      identifier: str
      role: str = "member"
  ```

**File**: `bot/dashboard/api/routers/workspace.py` (modify)

### Task 5.2: Add POST /workspace/{id}/invitations endpoint
- Create invitation endpoint
- Uses `WorkspaceContext` dependency
- Calls `WorkspaceService.create_invitation()`
- Returns 201 with invitation details
- Handles `WorkspaceError` → 422

**File**: `bot/dashboard/api/routers/workspace.py` (modify)
**Verify**: POST returns 201 with invitation; 403 for non-admin; 409 for duplicate

### Task 5.3: Add GET /workspace/{id}/invitations endpoint
- List invitations for workspace
- Uses `WorkspaceContext` dependency
- Calls `WorkspaceService.list_invitations()`
- Returns 200 with invitations list (no tokens)

**File**: `bot/dashboard/api/routers/workspace.py` (modify)
**Verify**: Returns list of invitations for the workspace

### Task 5.4: Add GET /workspace/invitations/pending endpoint
- List own pending invitations
- Uses `get_identity()` directly (no `WORKSPACE_BOUNDARY`)
- Resolves `user_id` via `UserService.get_or_create_user_by_tg_id()`
- Calls `WorkspaceService.list_user_pending_invitations()`
- Returns 200 with pending invitations (including tokens)

**File**: `bot/dashboard/api/routers/workspace.py` (modify)
**Verify**: Returns only the authenticated user's pending invitations

### Task 5.5: Add POST /workspace/invitations/{token}/accept endpoint
- Accept invitation
- Uses `get_identity()` directly
- Resolves `user_id`
- Calls `WorkspaceService.accept_invitation(token, user_id)`
- Returns 200 with workspace details
- Handles 403 (wrong user), 404 (not found), 409 (not pending), 410 (expired)

**File**: `bot/dashboard/api/routers/workspace.py` (modify)
**Verify**: Correct user accepts → 200; wrong user → 403; expired → 410

### Task 5.6: Add POST /workspace/invitations/{token}/decline endpoint
- Decline invitation
- Uses `get_identity()` directly
- Calls `WorkspaceService.decline_invitation(token, user_id)`
- Returns 200
- Idempotent

**File**: `bot/dashboard/api/routers/workspace.py` (modify)
**Verify**: Decline works; repeated decline returns 200

### Task 5.7: Add POST /workspace/{id}/invitations/{token}/revoke endpoint
- Revoke invitation
- Uses `WorkspaceContext` dependency
- Calls `WorkspaceService.revoke_invitation(token, tenant_id, actor_user_id)`
- Returns 200

**File**: `bot/dashboard/api/routers/workspace.py` (modify)
**Verify**: Admin revokes → 200; member cannot revoke → 403

### Task 5.8: Add POST /workspace/{id}/invitations/{token}/resend endpoint
- Resend invitation
- Uses `WorkspaceContext` dependency
- Calls `WorkspaceService.resend_invitation(token, tenant_id, actor_user_id)`
- Returns 200 with updated expiration

**File**: `bot/dashboard/api/routers/workspace.py` (modify)
**Verify**: Resend extends expiration; sends new notification

### Task 5.9: Remove old POST /workspace/{id}/invite endpoint
- Remove the `invite_workspace_member` route handler
- Remove `InviteMemberRequest` model (replaced by `CreateInvitationRequest`)
- Update dual-mounted routes (both `/api/` and `/webapp/` prefixes)

**File**: `bot/dashboard/api/routers/workspace.py` (modify)
**Verify**: Old endpoint returns 404; new endpoint works

## Phase 6: Frontend — API Client + Types

### Task 6.1: Add TypeScript types
- Add to `dashboard/src/lib/types.ts`:
  ```typescript
  export interface WorkspaceInvitation {
    id: number
    invited_user_id: number
    invited_username: string | null
    invited_full_name: string | null
    inviter_user_id: number
    inviter_username: string | null
    inviter_full_name: string | null
    role: WorkspaceRole
    status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked'
    created_at: string
    expires_at: string
    accepted_at: string | null
    declined_at: string | null
    revoked_at: string | null
  }

  export interface PendingInvitation {
    id: number
    workspace_id: number
    workspace_name: string
    inviter_username: string | null
    inviter_full_name: string | null
    role: WorkspaceRole
    status: 'pending'
    token: string
    created_at: string
    expires_at: string
  }
  ```

**File**: `dashboard/src/lib/types.ts` (modify)

### Task 6.2: Add API functions
- Add to `dashboard/src/lib/api.ts`:
  - `fetchWorkspaceInvitations(workspaceId: number)` — GET
  - `createWorkspaceInvitation(workspaceId: number, identifier: string, role: string)` — POST
  - `fetchPendingInvitations()` — GET (no workspace_id)
  - `acceptInvitation(token: string)` — POST
  - `declineInvitation(token: string)` — POST
  - `revokeWorkspaceInvitation(workspaceId: number, token: string)` — POST
  - `resendWorkspaceInvitation(workspaceId: number, token: string)` — POST
- Remove old `inviteTeamWorkspaceMember()` function

**File**: `dashboard/src/lib/api.ts` (modify)
**Verify**: TypeScript compiles; functions match backend contracts

## Phase 7: Frontend — MembersPage Updates

### Task 7.1: Update invite dialog
- Change invite dialog to call `createWorkspaceInvitation()` instead of `inviteTeamWorkspaceMember()`
- Update success message: "Invitation sent" instead of "Member invited"
- Add role validation: exclude "owner" from role options (already done — only admin/member/viewer shown)

**File**: `dashboard/src/pages/MembersPage.tsx` (modify)
**Verify**: Invite creates pending invitation; old behavior gone

### Task 7.2: Add "My Pending Invitations" section
- Add new query: `fetchPendingInvitations()` with React Query
- Add card below members table showing pending invitations for the current user
- Each row: workspace name, inviter, role, created date, expiration, Accept/Decline buttons
- Accept mutation: `acceptInvitation(token)` → invalidate queries, show toast
- Decline mutation: `declineInvitation(token)` → invalidate queries, show toast
- Empty state when no pending invitations

**File**: `dashboard/src/pages/MembersPage.tsx` (modify)
**Verify**: Pending invitations shown; accept/decline work

### Task 7.3: Add "Sent Invitations" section
- Add new query: `fetchWorkspaceInvitations(activeWs)` (only when user is owner/admin)
- Add card within workspace context showing all invitations sent for that workspace
- Each row: user, role, invited by, created date, expiration, status, Resend/Revoke buttons
- Resend mutation: `resendWorkspaceInvitation(wsId, token)` → invalidate queries
- Revoke mutation: `revokeWorkspaceInvitation(wsId, token)` → invalidate queries
- Only visible to owners/admins

**File**: `dashboard/src/pages/MembersPage.tsx` (modify)
**Verify**: Admin sees sent invitations; member does not

### Task 7.4: Remove old inviteTeamWorkspaceMember import
- Remove the old import from `MembersPage.tsx`

**File**: `dashboard/src/pages/MembersPage.tsx` (modify)

## Phase 8: i18n

### Task 8.1: Add invitation translation keys
- Add to `dashboard/src/lib/i18n.tsx` DICT:
  ```
  invitations.title          — "Pending Invitations" / "الدعوات المعلقة"
  invitations.empty         — "No pending invitations" / "لا توجد دعوات معلقة"
  invitations.accept        — "Accept" / "قبول"
  invitations.decline       — "Decline" / "رفض"
  invitations.accepted      — "Accepted" / "تم القبول"
  invitations.declined      — "Declined" / "تم الرفض"
  invitations.expired       — "Expired" / "منتهية الصلاحية"
  invitations.revoked       — "Revoked" / "تم الإلغاء"
  invitations.pending       — "Pending" / "معلقة"
  invitations.workspace     — "Workspace" / "مساحة العمل"
  invitations.invitedBy     — "Invited by" / "دعوة من"
  invitations.role          — "Role" / "الدور"
  invitations.expires       — "Expires" / "تنتهي الصلاحية"
  invitations.created       — "Invited" / "تمت الدعوة"
  invitations.sent          — "Sent Invitations" / "الدعوات المرسلة"
  invitations.revoke        — "Revoke" / "إلغاء الدعوة"
  invitations.resend        — "Resend" / "إعادة الإرسال"
  invitations.sent_invitations — "Sent Invitations" / "الدعوات المرسلة"
  invitations.my_invitations  — "My Pending Invitations" / "دعواتي المعلقة"
  ```

**File**: `dashboard/src/lib/i18n.tsx` (modify)
**Verify**: Both EN and AR render correctly; RTL works for AR

### Task 8.2: Use translation keys in MembersPage
- Replace all hardcoded strings in the new invitation sections with `t()` calls

**File**: `dashboard/src/pages/MembersPage.tsx` (modify)
**Verify**: All strings are translatable

## Phase 9: Tests

### Task 9.1: Create test fixtures
- Create `tests/test_workspace_invitations.py`
- Add fixtures: test user, test workspace, test membership

**File**: `tests/test_workspace_invitations.py` (new)

### Task 9.2: Test invitation creation
- Owner creates invitation → record exists
- Admin creates invitation → record exists
- Member cannot create invitation → 403
- Viewer cannot create invitation → 403
- Invitation for unknown identifier → error
- Duplicate pending invitation → prevented
- Already-member user → error
- Owner role cannot be invited → error

**File**: `tests/test_workspace_invitations.py` (new)

### Task 9.3: Test invitation acceptance
- Correct user accepts → membership created
- Wrong user attempts acceptance → 403
- Accept expired invitation → 410
- Accept revoked invitation → 409
- Accept already-accepted invitation → 409
- Repeated accept request → idempotent
- Role assignment matches invitation

**File**: `tests/test_workspace_invitations.py` (new)

### Task 9.4: Test invitation decline
- Correct user declines → no membership created
- Repeated decline → idempotent

**File**: `tests/test_workspace_invitations.py` (new)

### Task 9.5: Test invitation revocation
- Admin revokes → status updated
- Member cannot revoke → 403
- Revoke already-revoked → idempotent

**File**: `tests/test_workspace_invitations.py` (new)

### Task 9.6: Test invitation resend
- Admin resends → expiration extended
- Resend expired → error

**File**: `tests/test_workspace_invitations.py` (new)

### Task 9.7: Test auto-revoke on member removal
- Remove member → pending invitations revoked

**File**: `tests/test_workspace_invitations.py` (new)

### Task 9.8: Test audit logging
- Each lifecycle event creates audit log entry

**File**: `tests/test_workspace_invitations.py` (new)

### Task 9.9: Test API endpoints
- All endpoints return correct status codes
- Auth checks work
- Error responses match contract

**File**: `tests/test_workspace_invitations.py` (new)

## Phase 10: Lint + Type Check

### Task 10.1: Run ruff
```bash
ruff check bot/
```
Fix any issues.

### Task 10.2: Run mypy
```bash
mypy bot/
```
Fix any issues.

### Task 10.3: Run full test suite
```bash
pytest -x -q
```
Verify no regressions.

## Task Summary

| Phase | Tasks | Estimated Effort |
|-------|-------|-----------------|
| 1. Database Model + Migration | 3 | Small |
| 2. Invitation Service Methods | 10 | Medium-Large |
| 3. Audit Logging | 2 | Small |
| 4. Notifications | 3 | Small |
| 5. API Router | 9 | Medium |
| 6. Frontend Types + API | 2 | Small |
| 7. MembersPage Updates | 4 | Medium |
| 8. i18n | 2 | Small |
| 9. Tests | 9 | Medium |
| 10. Lint + Type Check | 3 | Small |
| **Total** | **47** | **~2-3 days** |
