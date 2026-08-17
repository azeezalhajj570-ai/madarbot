# Clarification: Workspace Member Invitations

## Open Questions Requiring Resolution

### Q1: Invited-user invitations UI location

**Question**: Where should the invited user see their pending invitations?

**Options**:
- **A**: New sidebar route `/invitations` — dedicated page, clean separation
- **B**: Section within Members page — all workspace management in one place
- **C**: Banner/notification on dashboard load — non-intrusive, action-oriented

**Recommendation**: **A (new sidebar route)**. The Members page is workspace-scoped (you select a workspace, then see its members). The invited user's pending invitations span ALL workspaces they've been invited to — a separate page is the natural fit. A banner (C) could supplement this for urgent visibility.

**Decision needed**: Yes.

---

### Q2: Should the old `POST /workspace/{id}/invite` endpoint be removed or deprecated?

**Question**: The old endpoint creates `TenantMembership` directly. Should it be removed entirely, kept alongside the new one, or deprecated (kept but returning a deprecation warning)?

**Options**:
- **A**: Remove it — clean break, single invitation pathway
- **B**: Deprecate (keep + log warning) — backward compat for any external integrations
- **C**: Keep as-is alongside new endpoint — confusing, two pathways

**Recommendation**: **A (remove)**. There are no known external integrations consuming this endpoint. The dashboard frontend is the only caller, and it's updated as part of this feature. Removing avoids confusion.

**Decision needed**: Yes.

---

### Q3: What happens to existing pending invitations when the invited user is removed from the workspace?

**Question**: If a user is invited, then an admin removes them before they accept, what happens to the invitation?

**Options**:
- **A**: Invitation remains pending (user could re-accept later)
- **B**: Invitation is automatically revoked
- **C**: Invitation is automatically declined

**Recommendation**: **B (auto-revoke)**. If the admin removed the user, they don't want them in the workspace. Leaving the invitation pending creates confusion. Revoking it is clean and intentional.

**Decision needed**: Yes.

---

### Q4: Should the `GET /invitations/pending` endpoint include the invitation token?

**Question**: The token is needed for accept/decline operations. Should it be included in the list response so the frontend can call accept/decline without a second request?

**Options**:
- **A**: Include token in list response — frontend can accept/decline directly
- **B**: Exclude token — frontend fetches individual invitation details when needed

**Recommendation**: **A (include)**. The token is needed for the accept/decline API calls. There's no security benefit to hiding it from the invited user (they need it to act). Making the frontend make a second request is wasteful.

**Decision needed**: Yes.

---

### Q5: Should accepting an invitation auto-switch the workspace?

**Question**: After accepting, should the dashboard automatically switch to the new workspace, or leave the user on their current workspace?

**Options**:
- **A**: Auto-switch — immediate access to the new workspace
- **B**: Don't switch — user switches manually via workspace switcher
- **C**: Show a toast "Workspace added — switch now?" with a link

**Recommendation**: **B (don't switch)**. Auto-switching could be disorienting if the user was in the middle of something. The workspace switcher already provides easy access. A toast notification (C) is a good middle ground.

**Decision needed**: No (B is safe default, C is optional enhancement).

---

### Q6: Invitation expiration period

**Question**: Should the 7-day expiration be configurable, or hardcoded?

**Options**:
- **A**: Hardcoded 7 days — simple, consistent
- **B**: Configurable per-workspace via workspace settings
- **C**: Configurable per-invitation at creation time

**Recommendation**: **A (hardcoded 7 days for MVP)**. Configurability can be added later. 7 days is a reasonable default.

**Decision needed**: No (A is the MVP default).

---

### Q7: Should we support invitations for users who haven't logged in yet?

**Question**: The current system requires the target user to have a `User` record (created on first Telegram login). Should we support inviting users who haven't logged in?

**Options**:
- **A**: No — target must exist in the `users` table (current behavior)
- **B**: Yes — create a placeholder `User` record and notify via Telegram bot
- **C**: Yes — store invitation without a `User` record, resolve on first login

**Recommendation**: **A (no)**. Creating placeholder users adds complexity. The Telegram bot DM notification reaches users who have started the bot (which creates their `User` record). If they haven't started the bot, the in-app notification is the fallback.

**Decision needed**: No (A is the constraint from the user's prompt).

---

### Q8: How to handle the case where the invited user belongs to multiple workspaces?

**Question**: If a user is invited to workspace B while they're already a member of workspace A, should the invitation system handle this specially?

**Options**:
- **A**: No special handling — invitations are per-workspace, independent of each other
- **B**: Show workspace context in the invitation (which workspace, what role)
- **C**: Prevent invitations to users who are already in N workspaces

**Recommendation**: **A (no special handling)**. Invitations are already per-workspace by design. The `GET /invitations/pending` endpoint naturally shows all pending invitations across workspaces. No special logic needed.

**Decision needed**: No (A is the natural behavior).

---

## Resolved Decisions

The following decisions were already made in the spec and research documents:

1. **Extend WorkspaceService** — not a new service
2. **Token-based routes** — not integer IDs
3. **Partial unique index** — database-level duplicate prevention
4. **Expiration on-read** — no background worker
5. **In-app notification + optional Telegram DM** — two channels
6. **Replace old invite endpoint** — not deprecate
7. **Audit via AuditLog** — reuse existing table
8. **i18n via existing system** — EN + AR
9. **7-day hardcoded expiration** — MVP scope
10. **No auto-switch on accept** — manual workspace switching

## Clarification Summary

| # | Question | Recommendation | Decision Needed |
|---|----------|---------------|-----------------|
| Q1 | Invitations UI location | New sidebar route `/invitations` | Yes |
| Q2 | Old invite endpoint | Remove entirely | Yes |
| Q3 | Invitation after member removal | Auto-revoke | Yes |
| Q4 | Token in pending list response | Include token | Yes |
| Q5 | Auto-switch on accept | Don't auto-switch | No |
| Q6 | Expiration configurability | Hardcoded 7 days | No |
| Q7 | Invitations for non-existent users | Not supported | No |
| Q8 | Multi-workspace invitations | No special handling | No |
