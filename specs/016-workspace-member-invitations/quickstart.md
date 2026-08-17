# Quickstart: Workspace Member Invitations

## Implementation Order

### Step 1: Database Model + Migration
Create `WorkspaceInvitation` model and Alembic migration.

**Files**:
- `bot/db/models/workspace_invitation.py` (new)
- `bot/db/models/__init__.py` (add import)
- `alembic/versions/YYYYMMDD_NNN_add_workspace_invitations.py` (new migration)

**Migration details**:
- Create `workspace_invitations` table
- Add FKs: `tenant_id → tenants.id`, `invited_user_id → users.id`, `inviter_user_id → users.id`
- Add B-tree indexes on all key columns
- Add partial unique index: `uq_invitation_pending_per_user` on `(tenant_id, invited_user_id) WHERE status = 'pending'`
- Add UNIQUE index on `token`

### Step 2: InvitationService Methods on WorkspaceService
Add invitation lifecycle methods to `WorkspaceService`.

**Files**:
- `bot/services/workspace_service.py` (modify)

**New methods**:
```python
async def create_invitation(self, *, tenant_id, inviter_user_id, identifier, role) -> WorkspaceInvitation
async def list_invitations(self, tenant_id, status=None) -> list[dict]
async def list_user_pending_invitations(self, user_id) -> list[dict]
async def accept_invitation(self, *, token, user_id) -> TenantMembership
async def decline_invitation(self, *, token, user_id) -> None
async def revoke_invitation(self, *, token, tenant_id) -> None
async def resend_invitation(self, *, token, tenant_id) -> WorkspaceInvitation
async def _get_invitation_by_token(self, token) -> WorkspaceInvitation | None
```

**Key logic**:
- `create_invitation()`: validates role != "owner", checks not already member, checks no pending duplicate, generates UUID4 token, sets `expires_at = now() + 7 days`
- `accept_invitation()`: verifies ownership (invited_user_id == user_id), checks pending + not expired, creates TenantMembership + marks accepted in a transaction
- `decline_invitation()`: verifies ownership, marks declined (idempotent)
- `revoke_invitation()`: verifies admin/owner role, marks revoked
- `resend_invitation()`: verifies admin/owner role, extends `expires_at`

### Step 3: Audit Logging for Invitations
Add invitation event logging to `AuditLog`.

**Files**:
- `bot/services/workspace_service.py` (add audit calls in invitation methods)

**Implementation**:
```python
async def _audit_invitation(self, *, tenant_id, actor_user_id, action, invitation_id):
    from bot.db.models import AuditLog
    self.session.add(AuditLog(
        tenant_id=tenant_id,
        actor_type="user",
        actor_id=str(actor_user_id),
        action=f"invitation.{action}",
        target_type="workspace_invitation",
        target_id=str(invitation_id),
    ))
```

### Step 4: Notification on Invitation Creation
Send in-app notification + optional Telegram DM when an invitation is created.

**Files**:
- `bot/services/workspace_service.py` (add notification call in `create_invitation()` and `resend_invitation()`)

**In-app notification**:
- Create an `AgentNotification` with `kind="workspace_invitation"`, `agent_id=None`, `group_id=None`
- `title`: "Workspace Invitation"
- `body`: "You've been invited to {workspace_name} as {role} by {inviter_name}"
- `payload`: `{"invitation_token": token, "workspace_id": tenant_id, "workspace_name": name, "role": role, "inviter_name": name}`

**Telegram DM** (best-effort):
- If the invited user has a `tg_user_id`, try `bot.send_message(tg_user_id, text)`
- Use the main bot token via `bot.utils.bot_pool.BotPool.get()`
- Text includes workspace name, role, inviter name
- Catch and log exceptions (user may not have started the bot)

### Step 5: API Router
Add invitation endpoints to the workspace router.

**Files**:
- `bot/dashboard/api/routers/workspace.py` (modify)

**New endpoints**:
```python
@router.post("/api/workspace/{workspace_id}/invitations", status_code=201)
@router.get("/api/workspace/{workspace_id}/invitations")
@router.get("/api/workspace/invitations/pending")
@router.post("/api/workspace/invitations/{token}/accept")
@router.post("/api/workspace/invitations/{token}/decline")
@router.post("/api/workspace/{workspace_id}/invitations/{token}/revoke")
@router.post("/api/workspace/{workspace_id}/invitations/{token}/resend")
```

**Remove**: `POST /api/workspace/{workspace_id}/invite` (old direct-add endpoint)

**Request models** (Pydantic):
```python
class CreateInvitationRequest(BaseModel):
    identifier: str
    role: str = "member"
```

**Response models**: Inline dicts (consistent with existing pattern in the workspace router).

### Step 6: Frontend — Update MembersPage
Update the Members page to show pending invitations and use the new invitation API.

**Files**:
- `dashboard/src/pages/MembersPage.tsx` (modify)
- `dashboard/src/lib/api.ts` (add invitation API functions)
- `dashboard/src/lib/types.ts` (add invitation types)
- `dashboard/src/lib/i18n.tsx` (add invitation translation keys)

**Changes**:
1. Remove old `inviteTeamWorkspaceMember()` API call, replace with new invitation creation
2. Add a "Pending Invitations" card below the members table
3. Add revoke/resend buttons for pending invitations
4. Update the invite dialog to show "Invitation sent" instead of "Member invited"

### Step 7: Frontend — My Invitations Section in MembersPage
Add a "My Pending Invitations" section within the Members page for the authenticated user to see invitations addressed to them.

**Files**:
- `dashboard/src/pages/MembersPage.tsx` (modify — add invitations section)
- `dashboard/src/lib/api.ts` (add `fetchPendingInvitations()`, `acceptInvitation()`, `declineInvitation()`)
- `dashboard/src/lib/types.ts` (add `PendingInvitation` type)
- `dashboard/src/lib/i18n.tsx` (add invitation translation keys)

**Layout within MembersPage**:
- Below the workspace members card, add a "My Pending Invitations" card
- Each invitation shows:
  - Workspace name
  - Inviter name
  - Role
  - Created date
  - Expiration date
  - Accept button (green)
  - Decline button (outline)
- Empty state when no pending invitations
- Loading skeleton while fetching

### Step 8: i18n
Add English and Arabic translations for all new UI strings.

**Files**:
- `dashboard/src/lib/i18n.tsx` (add keys)

**New keys needed**:
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
members.pendingInvitations — "Pending Invitations" / "الدعوات المعلقة"
members.revoke            — "Revoke" / "إلغاء الدعوة"
members.resend            — "Resend" / "إعادة الإرسال"
members.invitationSent    — "Invitation sent" / "تم إرسال الدعوة"
```

### Step 9: Tests
Write backend tests for all invitation operations.

**Files**:
- `tests/test_workspace_invitations.py` (new)

**Test fixtures**: Use existing test patterns from the codebase.

### Step 10: Lint + Type Check
Run `ruff` and `mypy` to verify code quality.

```bash
ruff check bot/
mypy bot/
```

## Testing

```bash
# Run existing tests to verify no regressions
pytest -x -q

# Run new invitation tests
pytest tests/test_workspace_invitations.py -v

# Manual smoke test:
# 1. Login as User A (workspace owner)
# 2. Invite User B via username
# 3. Login as User B
# 4. Navigate to Invitations page
# 5. See pending invitation from User A
# 6. Accept invitation
# 7. Switch to the new workspace
# 8. Verify agents/groups are visible
```

## Rollback

If issues arise:
1. Revert the migration (drop `workspace_invitations` table)
2. Restore old `POST /workspace/{id}/invite` endpoint
3. No data loss — invitations are new data, existing memberships are untouched
