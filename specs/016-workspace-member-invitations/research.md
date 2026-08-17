# Research: Workspace Member Invitations

## Decision: Extend Existing WorkspaceService, Don't Create New Service

**Rationale**: `WorkspaceService` (`bot/services/workspace_service.py`) already owns all workspace member management logic. Adding invitation methods to it keeps business logic in one place and avoids splitting related concerns across files.

**Alternatives considered**:
1. New `InvitationService` — rejected because it fragments workspace logic. The invitation system is tightly coupled to workspace membership (creating invitations checks membership, accepting invitations creates membership).
2. Inline logic in router — rejected per existing codebase convention: business logic lives in services, not routes.

## Decision: Token-Based Routes (Not Integer IDs)

**Rationale**: Using invitation tokens as path parameters for accept/decline/revoke/resend prevents IDOR attacks. Integer IDs are guessable; UUID4 tokens are not. This matches the security requirements and is consistent with patterns like password reset tokens.

**Alternatives considered**:
1. Integer IDs + workspace membership check — works for revoke/resend (admin context), but fails for accept/decline (the invited user doesn't have workspace membership yet, so there's no membership to verify against).
2. Composite key (workspace_id + user_id) — requires the invited user to supply their own user ID, which they shouldn't need to know.

## Decision: Replace Old Invite Endpoint (Not Deprecate)

**Rationale**: The old `POST /workspace/{id}/invite` directly creates `TenantMembership`. Keeping it alongside the new invitation endpoint would create two competing pathways for adding members. Removing it ensures a single, clean invitation flow.

**Impact**: Any frontend code calling `inviteTeamWorkspaceMember()` must be updated to use the new invitation creation endpoint. The `MembersPage.tsx` invite dialog is updated as part of this feature.

**Migration safety**: No existing data is affected — only the API contract changes. The old endpoint's logic (direct membership creation) is what we're replacing.

## Decision: Use Partial Unique Index for Duplicate Prevention

**Rationale**: A partial unique index on `(tenant_id, invited_user_id) WHERE status = 'pending'` provides database-level protection against duplicate active invitations while allowing historical records. Combined with application-level checks (for clear error messages), this is defense-in-depth.

**PostgreSQL requirement**: MadarBot uses PostgreSQL 16, which supports partial unique indexes natively.

**SQLAlchemy implementation**: Use `Index()` with `postgresql_where` parameter, not `UniqueConstraint()` (which doesn't support WHERE clauses).

## Decision: Expiration On-Read, Not Background Worker

**Rationale**: Computing `expires_at < now()` on every read is simple and correct. A background worker would add operational complexity (scheduling, failure recovery) for no functional benefit — the system doesn't need to "wake up" when an invitation expires.

**Cleanup**: Optional periodic cleanup of old invitation records (e.g., delete records older than 90 days with terminal status) can be added later but is not required for correctness.

## Decision: In-App Notification + Optional Telegram DM

**Rationale**: Two notification channels ensure coverage:
1. **In-app** (via `AgentNotification` or a new lightweight mechanism): Works for users who open the dashboard. Always available.
2. **Telegram DM** (via `bot.send_message()`): Reaches users who haven't opened the dashboard. Requires the user to have started the bot.

**Existing patterns**:
- `AgentNotification` (`bot/db/models/agent_notification.py`) stores in-app notifications with `kind`, `title`, `body`, `payload`. The invited user's notification would use `kind="workspace_invitation"` with `payload` containing `invitation_token`, `workspace_name`, etc.
- `bot.send_message(chat_id, text)` is used throughout the codebase for admin notifications (subscription approvals, health alerts). Same pattern, different recipient.

**Decision**: Reuse `AgentNotification` for in-app notifications rather than creating a new table. The `agent_id` and `group_id` fields can be NULL (they're already nullable). Add a new `kind` value `"workspace_invitation"`.

**Alternative**: Create a new `WorkspaceInvitationNotification` table. Rejected as unnecessary — `AgentNotification` already supports the required fields and the frontend already renders notification lists.

## Decision: Invitations UI as New Dashboard Route

**Rationale**: The Members page is already dense (workspace selector, member table, invite dialog). Adding an invitations section would make it more cluttered. A separate `/invitations` route provides:
- Clean separation of concerns (member management vs. invitation management)
- A dedicated space for the invited user's accept/decline flow
- Easier i18n (separate translation keys for a focused page)

**Implementation**: Add a new route in the dashboard SPA router, a new sidebar entry, and a new page component.

## Decision: INVITATIONS_BOUNDARY for Pending Invitations Endpoint

**Rationale**: The `GET /invitations/pending` endpoint and accept/decline endpoints don't belong to any specific workspace — they're user-scoped, not workspace-scoped. They don't need `WORKSPACE_BOUNDARY` (which requires an `X-App-Boundary` header). They use standard dashboard authentication.

**Implementation**: These endpoints use `Depends(get_identity)` directly, without `WORKSPACE_BOUNDARY`.

## Audit Event Mapping

| Lifecycle Event | AuditLog Action | AuditLog Target |
|-----------------|-----------------|-----------------|
| Invitation created | `invitation.created` | `workspace_invitation:{id}` |
| Invitation resent | `invitation.resent` | `workspace_invitation:{id}` |
| Invitation accepted | `invitation.accepted` | `workspace_invitation:{id}` |
| Invitation declined | `invitation.declined` | `workspace_invitation:{id}` |
| Invitation revoked | `invitation.revoked` | `workspace_invitation:{id}` |

All events include `tenant_id` for multi-tenant scoping, `actor_type="user"`, and `actor_id=str(user.id)`.
