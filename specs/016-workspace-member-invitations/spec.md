# Feature Specification: Workspace Member Invitations

**Feature Branch**: `016-workspace-member-invitations`

**Created**: 2026-08-17

**Status**: Draft

**Depends on**: `015-workspace-mvp` (implemented)

**Input**: User description: "Implement a proper workspace invitation system with pending state, tokens, accept/decline flow, expiration, and notifications"

## Problem Statement

The current workspace "invite" functionality (`WorkspaceService.invite_member()`) is a direct-add operation: it immediately creates a `TenantMembership` record when an owner/admin enters a Telegram username or user ID. There is no pending state, no invitation token, no acceptance or decline flow, no expiration, and no notification to the invited user. The target user has no opportunity to accept or reject access to the workspace.

This means:
1. A user can be added to a workspace without their knowledge or consent.
2. If the target user doesn't exist in the system yet, the invite fails entirely.
3. There is no audit trail of who invited whom and when.
4. There is no way to revoke an invitation before it's used.
5. There is no expiration mechanism for stale invitations.

## Goals

1. Replace the direct-add "invite" with a proper invitation lifecycle: create → pending → accept/decline/expired/revoked.
2. Add a persistent `WorkspaceInvitation` model with status tracking, secure tokens, and expiration.
3. Allow invited users to accept or decline invitations through the browser dashboard.
4. Notify invited users via in-app notification and optional Telegram bot message.
5. Allow workspace admins/owners to revoke and resend pending invitations.
6. Enforce authorization server-side: only owners/admins can manage invitations; only the intended user can accept/decline.
7. Maintain full backward compatibility with existing workspace memberships and APIs.
8. Record invitation lifecycle events in the existing `AuditLog` table.

## Non-Goals

1. **Email-based invitations** — MadarBot is Telegram-native; email is not a channel.
2. **Invitations for non-existent users** — the target must already have a `User` record (created on first Telegram login). Creating accounts on behalf of invitees is out of scope.
3. **Multi-workspace invitation batching** — each invitation is scoped to one workspace.
4. ** Invitation links shareable via URL** — invitations are tied to the authenticated user via their `User.id`; sharing a link doesn't grant access to someone else.
5. **Background worker for expiration** — expiration is computed on-read (check `expires_at < now()`), not by a periodic job.

## User Stories

### US-1: Owner Invites a Team Member (P1)

**As** a workspace owner,
**I want** to invite a Telegram user to my workspace by their username or user ID,
**so that** they can review and accept the invitation before gaining access.

**Acceptance Scenarios**:
1. Given I am a workspace owner, when I enter a valid Telegram username, then a pending invitation is created and the user is notified.
2. Given I am a workspace owner, when I enter a Telegram user ID, then a pending invitation is created and the user is notified.
3. Given I am a workspace owner, when I try to invite someone who is already a member, then I receive a clear error.
4. Given I am a workspace owner, when I try to invite someone with an active pending invitation, then I receive a duplicate-prevention error or the invitation is resent.

### US-2: Invited User Accepts Invitation (P1)

**As** an invited user,
**I want** to see my pending workspace invitations and accept or decline them,
**so that** I have control over which workspaces I join.

**Acceptance Scenarios**:
1. Given I have a pending invitation, when I view my invitations, then I see workspace name, inviter, role, and expiration.
2. Given I have a pending invitation, when I click Accept, then a membership is created with the invited role and the invitation is marked accepted.
3. Given I have a pending invitation, when I click Decline, then no membership is created and the invitation is marked declined.
4. Given I accept an invitation, when the workspace switches, then I can see the workspace's agents and groups.

### US-3: Admin Manages Pending Invitations (P1)

**As** a workspace admin,
**I want** to see, revoke, and resend pending invitations,
**so that** I can manage who has outstanding invitations.

**Acceptance Scenarios**:
1. Given I am a workspace admin, when I view the members page, then I see pending invitations alongside current members.
2. Given I am a workspace admin, when I revoke a pending invitation, then it can no longer be accepted.
3. Given I am a workspace admin, when I resend a pending invitation, then the invited user receives a new notification and the expiration is extended.

### US-4: Invitation Expiration (P2)

**As** the system,
**I want** invitations to expire after a configurable period (default: 7 days),
**so that** stale invitations don't accumulate indefinitely.

**Acceptance Scenarios**:
1. Given an invitation has passed its `expires_at`, when the invited user tries to accept, then the request is rejected with an expiration message.
2. Given an invitation has passed its `expires_at`, when displayed in the dashboard, then it shows as "Expired".

### US-5: Member/Viewer Cannot Invite (P2)

**As** a workspace member or viewer,
**I should not** be able to create invitations,
**because** only owners and admins have invite privileges.

**Acceptance Scenarios**:
1. Given I am a workspace member, when I try to create an invitation via the API, then the request is rejected with 403.

## Invitation Lifecycle / State Machine

```
                  ┌──────────────────────────────────────────────┐
                  │                                              │
                  ▼                                              │
              [PENDING] ─────────────────────────────────► [ACCEPTED]
                  │                                              │
                  │                                              │
                  ├──────────────► [DECLINED]                    │
                  │   (invited user)                             │
                  │                                              │
                  ├──────────────► [EXPIRED]                     │
                  │   (expires_at < now())                       │
                  │                                              │
                  └──────────────► [REVOKED]                     │
                      (admin/owner)                              │
                                                                │
                  [ACCEPTED] creates TenantMembership            │
                  [DECLINED] no membership created               │
                  [EXPIRED] no membership created                │
                  [REVOKED] no membership created                │
```

### Valid State Transitions

| From | To | Trigger | Guard |
|------|----|---------|-------|
| — | PENDING | `create_invitation()` | Target user exists, not already a member, no active pending invitation for same workspace/user |
| PENDING | ACCEPTED | `accept_invitation()` | Invitation belongs to authenticated user, `expires_at > now()`, not already accepted/declined/revoked |
| PENDING | DECLINED | `decline_invitation()` | Invitation belongs to authenticated user, not already accepted/declined/revoked |
| PENDING | REVOKED | `revoke_invitation()` | Actor has owner/admin role in the workspace |
| PENDING | EXPIRED | (implicit) | `expires_at < now()` — computed on read, not a stored state change |

### Terminal States

`ACCEPTED`, `DECLINED`, `EXPIRED`, `REVOKED` are all terminal. No transitions out of these states.

## Functional Requirements

### FR-001: Invitation Creation
- Workspace owners and admins can create invitations.
- Invitation targets a Telegram username or Telegram user ID.
- The inviter selects a role: `admin`, `member`, or `viewer`.
- `owner` role must never be assignable through an invitation.
- If the target user is already a workspace member, return error.
- If there is already a pending invitation for the same workspace/user, prevent duplicate (or provide resend).
- Invitations are associated with workspace, inviter, invited user, and requested role.
- A secure token is generated for each invitation.

### FR-002: Pending Invitations
- A `WorkspaceInvitation` table stores all invitation records.
- Contains: id, tenant_id, invited_user_id, inviter_user_id, role, status, token, created_at, expires_at, accepted_at, declined_at, revoked_at.
- Statuses: pending, accepted, declined, expired, revoked.
- No invalid state transitions are allowed.

### FR-003: Invitation Acceptance
- Authenticated user can accept a pending invitation.
- Verifies invitation belongs to the authenticated user.
- Verifies invitation is still pending and not expired.
- Creates `TenantMembership` with the invited role.
- Marks invitation as accepted with timestamp.
- Operation is transactional and idempotent.

### FR-004: Invitation Decline
- Invited user can decline a pending invitation.
- No membership is created.
- Invitation is marked declined with timestamp.
- Repeated decline requests are safe/idempotent.

### FR-005: Expiration
- Invitations expire based on `expires_at` (default: 7 days from creation).
- Expiration is computed on-read, no background worker required.
- Expired invitations cannot be accepted.

### FR-006: Revocation
- Workspace owners/admins can revoke pending invitations.
- A revoked invitation cannot be accepted.
- Revoked invitations show status "Revoked" in the dashboard.

### FR-007: Notifications
- When an invitation is created, the invited user receives an in-app notification (via `AgentNotification` or a new dedicated mechanism).
- Optionally, a Telegram bot message is sent if the user has started the bot.
- Notification includes: workspace name, inviter name, role, and a deep link to accept/decline.
- On resend, a new notification is sent.

### FR-008: Browser Dashboard — Members Page
- The existing Members page (`dashboard/src/pages/MembersPage.tsx`) is updated.
- A "Pending Invitations" section is added below the members table.
- Shows: invited user, role, invited by, created date, expiration date, status.
- Owners/admins can: create invitation, resend invitation, revoke pending invitation.
- Members/viewers cannot manage invitations (UI elements are hidden/disabled).

### FR-009: Invited-User Experience
- The authenticated user can view their pending invitations.
- Shows: workspace name, inviter, role, created date, expiration, Accept/Decline buttons.
- After accepting, the workspace appears in the workspace switcher.

### FR-010: API Endpoints
- REST endpoints consistent with existing dashboard API conventions.
- Dual-mounted at `/api/workspace/...` and `/webapp/workspace/...`.
- Invitation tokens are not exposed in list endpoints.

### FR-011: Authorization
- Owner can manage all invitations.
- Admin can manage invitations (consistent with existing `ROLES_THAT_CAN_INVITE`).
- Member/viewer cannot create, resend, or revoke invitations.
- Only the intended user can accept/decline.
- Workspace and user identity verified server-side, not from frontend params.

### FR-012: Database Migration
- New Alembic migration creates `workspace_invitations` table.
- Adds foreign keys, indexes, uniqueness constraints.
- Preserves all existing workspace data.
- Does not modify or replace the `015-workspace-mvp` migration.

### FR-013: Backward Compatibility
- Existing workspace memberships continue working.
- Existing member listing, role change, and removal APIs unchanged.
- The current direct "invite" endpoint (`POST /workspace/{id}/invite`) is replaced by the invitation creation endpoint. The old endpoint is removed (not deprecated) since the new endpoint subsumes its purpose.
- Business logic lives in the service layer, not duplicated in routes.

### FR-014: Auditability
- Invitation lifecycle events are recorded in the `AuditLog` table (tenant-scoped).
- Events: `invitation.created`, `invitation.resent`, `invitation.accepted`, `invitation.declined`, `invitation.revoked`.
- Uses the existing `AuditLog` model with `target_type="workspace_invitation"`.

### FR-015: Security
- Invitation tokens are cryptographically secure (UUID4 or similar).
- No IDOR: invitation ownership verified via authenticated `User.id`, not frontend-supplied IDs.
- No role escalation: owner role cannot be assigned via invitation.
- Acceptance is transactional to prevent duplicate membership.
- Tokens not exposed in list/detail responses to other users.

### FR-016: i18n
- All new UI strings support EN and AR via the existing `useI18n()` system.
- No new i18n framework introduced.

## Database Model

### WorkspaceInvitation

```
Table: workspace_invitations

Columns:
├── id:              Integer (PK, autoincrement)
├── tenant_id:       Integer FK → tenants.id (NOT NULL, ON DELETE CASCADE)
├── invited_user_id: Integer FK → users.id (NOT NULL, ON DELETE CASCADE)
├── inviter_user_id: Integer FK → users.id (NOT NULL, ON DELETE CASCADE)
├── role:            String(32) NOT NULL — 'admin' | 'member' | 'viewer'
├── status:          String(20) NOT NULL DEFAULT 'pending' — 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked'
├── token:           String(64) NOT NULL UNIQUE — cryptographically secure identifier
├── created_at:      DateTime(timezone=True) NOT NULL DEFAULT now()
├── expires_at:      DateTime(timezone=True) NOT NULL — created_at + 7 days
├── accepted_at:     DateTime(timezone=True) NULLABLE
├── declined_at:     DateTime(timezone=True) NULLABLE
├── revoked_at:      DateTime(timezone=True) NULLABLE
└── updated_at:      DateTime(timezone=True) NOT NULL DEFAULT now()

Indexes:
├── ix_workspace_invitations_tenant_id (tenant_id)
├── ix_workspace_invitations_invited_user_id (invited_user_id)
├── ix_workspace_invitations_inviter_user_id (inviter_user_id)
├── ix_workspace_invitations_status (status)
├── ix_workspace_invitations_token (token) — UNIQUE
└── ix_workspace_invitations_created_at (created_at)

Unique Constraints:
├── uq_invitation_tenant_user_pending — UNIQUE(tenant_id, invited_user_id) WHERE status = 'pending'
│   (prevents duplicate pending invitations for same user in same workspace)
```

## Authorization Model

| Action | Owner | Admin | Member | Viewer | Invited User |
|--------|-------|-------|--------|--------|--------------|
| Create invitation | ✅ | ✅ | ❌ | ❌ | — |
| List invitations (workspace) | ✅ | ✅ | ❌ | ❌ | — |
| Resend invitation | ✅ | ✅ | ❌ | ❌ | — |
| Revoke invitation | ✅ | ✅ | ❌ | ❌ | — |
| List own pending invitations | — | — | — | — | ✅ |
| Accept invitation | — | — | — | — | ✅ (own only) |
| Decline invitation | — | — | — | — | ✅ (own only) |

## API Requirements

See `contracts/api.md` for full endpoint specifications.

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/workspace/{id}/invitations` | owner/admin | List invitations for workspace |
| `POST` | `/api/workspace/{id}/invitations` | owner/admin | Create invitation |
| `POST` | `/api/workspace/invitations/{token}/accept` | invited user | Accept invitation |
| `POST` | `/api/workspace/invitations/{token}/decline` | invited user | Decline invitation |
| `POST` | `/api/workspace/{id}/invitations/{token}/revoke` | owner/admin | Revoke invitation |
| `POST` | `/api/workspace/{id}/invitations/{token}/resend` | owner/admin | Resend notification |
| `GET` | `/api/workspace/invitations/pending` | any user | List own pending invitations |

### Design Decisions

- **Token-based routes for accept/decline/revoke/resend** instead of integer IDs: prevents IDOR, tokens are not guessable.
- **Accept/decline use the token** as the path parameter: the invited user proves ownership by possessing the token, not by supplying a user ID.
- **Revoke/resend use workspace_id + token**: the admin proves workspace membership via `WorkspaceContext`, and the token identifies the specific invitation.
- **Pending invitations endpoint** (`GET /invitations/pending`): authenticated user sees only their own pending invitations, scoped by `invited_user_id`.

## Notification Behavior

### On Invitation Creation
1. Create an `AgentNotification`-style in-app notification for the invited user (kind: `workspace_invitation`).
2. If the invited user has a `tg_user_id` and the bot is available, send a Telegram DM via `bot.send_message()` with:
   - Workspace name
   - Inviter name
   - Role
   - Deep link to dashboard invitations page

### On Resend
1. Create a new in-app notification.
2. Optionally send a new Telegram DM.

### On Accept/Decline/Revoke
No notification to the invited user on accept/decline (they performed the action).
Optionally notify the inviter on accept (in-app notification).

## Browser Dashboard Behavior

### Members Page Updates

The existing Members page (`MembersPage.tsx`) is extended with two invitation sections:

1. **Members table** — unchanged.
2. **"My Pending Invitations" card** — below the members table, showing invitations FOR the current user across all workspaces:
   - Table columns: Workspace, Invited By, Role, Created, Expires, Status, Actions
   - Actions: Accept (green button), Decline (outline button)
   - Status badges: Pending (warning), Accepted (success), Declined (neutral), Expired (neutral), Revoked (destructive)
   - Empty state when no pending invitations
3. **Workspace-scoped "Sent Invitations" card** — for owners/admins, within the workspace context, showing all invitations they sent for that workspace:
   - Table columns: User, Role, Invited By, Created, Expires, Status, Actions
   - Actions: Resend (for pending), Revoke (for pending)
   - Only visible to owners/admins
4. **Invite button** — opens the existing invite dialog (updated to create pending invitations instead of direct membership).

## Security Requirements

1. **No IDOR**: Invitation operations use tokens, not integer IDs guessable by other users.
2. **Server-side auth**: All authorization checks are in the backend service layer.
3. **No role escalation**: `owner` role is excluded from invitation options both frontend and backend.
4. **Token uniqueness**: `token` column has a UNIQUE index.
5. **Token format**: UUID4 (128-bit random), stored as hex string (64 chars).
6. **Transaction safety**: Acceptance creates membership and updates invitation status in a single transaction.
7. **No trust of frontend params**: `invited_user_id` and `tenant_id` are resolved from the authenticated user and the token, not from request body.

## Migration Requirements

- New Alembic migration: `YYYYMMDD_NNN_add_workspace_invitations.py`
- Creates `workspace_invitations` table with all columns, FKs, indexes, and constraints.
- Does not modify any existing tables.
- Does not modify or replace the `015-workspace-mvp` migration.
- Safe to apply to production: additive-only, no data loss.

## Testing Requirements

### Backend Tests

| Test Case | Category |
|-----------|----------|
| Owner creates invitation | Happy path |
| Admin creates invitation | Happy path |
| Member cannot create invitation | Authorization |
| Viewer cannot create invitation | Authorization |
| Invitation for unknown identifier returns error | Validation |
| Duplicate pending invitation prevented | Uniqueness |
| Already-member user returns error | Validation |
| Owner role cannot be invited | Validation |
| Invitation acceptance succeeds | Happy path |
| Invitation decline succeeds | Happy path |
| Expired invitation rejected | Expiration |
| Revoked invitation rejected | Revocation |
| Wrong user attempting acceptance fails | Security |
| Role assignment matches invitation | Happy path |
| Repeated accept request is idempotent | Idempotency |
| Repeated decline request is idempotent | Idempotency |
| Invitation listed in workspace invitations | Happy path |
| Pending invitations listed for invited user | Happy path |
| Resend creates new notification | Happy path |
| Revoke sets status correctly | Happy path |
| Audit log recorded on creation | Audit |
| Audit log recorded on acceptance | Audit |

### Frontend Tests

- Add tests where existing project testing conventions support them (Vitest).
- Test invitation list rendering, accept/decline button states, error handling.

## Acceptance Criteria

1. An owner/admin can invite an existing MadarBot user by username or user ID.
2. The invited user receives an in-app notification and optional Telegram DM.
3. The invited user sees the pending invitation in their dashboard.
4. The user can accept or decline.
5. Accepting creates exactly one `TenantMembership` with the invited role.
6. Declining does not create membership.
7. Expired invitations cannot be accepted.
8. Revoked invitations cannot be accepted.
9. An invitation cannot be accepted by a user other than the invitee.
10. Duplicate pending invitations for the same workspace/user are prevented.
11. Admin/owner authorization is enforced server-side.
12. Pending invitations are visible in the browser dashboard members page.
13. Admins/owners can revoke and resend pending invitations.
14. Existing workspace functionality (members, roles, removal) continues to work.
15. EN and AR UI are supported.
16. Database migration is included and safe.
17. Backend tests cover security, authorization, and state transitions.
18. Existing tests remain green.

## Resolved Decisions

1. **Invitations UI lives within the Members page** — a "Pending Invitations" card is added below the member table. No separate sidebar route.
2. **Old `POST /workspace/{id}/invite` endpoint is removed** — the new invitation endpoint replaces it entirely.
3. **Invitations are auto-revoked when a user is removed** — if an admin removes a member who has a pending invitation, the invitation is revoked.
4. **Token is included in the pending invitations list response** — the invited user needs it for accept/decline operations.
5. **No auto-switch on accept** — the user switches workspaces manually via the existing workspace switcher.
6. **7-day hardcoded expiration** — no configurability for MVP.
7. **Invitations require an existing User record** — the target must have logged in at least once.
8. **No special multi-workspace handling** — invitations are per-workspace, independent.
