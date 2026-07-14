# Implementation Plan: Bulk Add Members Backend Wiring + Tracking UI

## Overview

Issue #60 — "Bulk Add Members: wire up missing backend orchestration + add tracking UI". The bulk-add feature has a fully built frontend and a fully built low-level execution layer (Telethon calls, Dramatiq actor, audit logging), but a critical piece is missing: the `can_add_members` field is never returned by the backend, causing the frontend's target-group dropdown to always be empty. Additionally, per-user job progress is not surfaced in the dashboard UI.

## Current State

| Component | Status |
|-----------|--------|
| `MEMBER_ADD_JOB_TYPE` constant | ✅ `jobs.py:7` |
| `BulkMemberAddRequest` model | ✅ `_shared.py:123-127` |
| POST `/webapp/agents/{id}/member-adds` endpoint | ✅ `agents.py:684-732` |
| `_handle_member_add_job()` executor | ✅ `worker.py:450-578` |
| Job dispatch in `_execute_agent_job_impl()` | ✅ `worker.py:738-746` |
| Notification builder for `member_add` | ✅ `worker.py:292-318` |
| Flood-wait handling + retry | ✅ `worker.py:554-570` |
| Dedup (skip already-member users) | ✅ `worker.py:538-541` |
| `MembershipAuditLog` writing | ✅ `worker.py:501-512` |
| `GroupMember` record creation | ✅ `worker.py:516-535` |
| Frontend modal / form / member search | ✅ `index.html` |
| Frontend job listing (filter `member_add`) | ✅ `index.html:5092` |
| **`can_add_members` field in `list_managed_member_groups`** | ❌ Missing — **the blocker** |
| **Frontend per-user result display** | ❌ Missing |
| **Job progress tracking UI** | ❌ Missing |

## Root Cause

The frontend at `index.html:2374` filters target groups:
```js
const targetGroups = sourceGroups.filter((group) => Boolean(group.can_add_members));
```

But `AccountGroupMembershipService.list_managed_member_groups()` never computes or returns a `can_add_members` field. The field appears **nowhere** in the backend response. Result: the target group `<select>` is always empty, making the feature unusable.

## Architecture Decisions

1. **`can_add_members` = agent has admin/creator role in the group.** The agent's Telegram user ID (`Agent.telegram_user_id`) is checked against `scraped_members` table. If a record exists for `tg_user_id == agent.telegram_user_id` AND `tg_group_id == group.tg_group_id` AND `role IN ('admin', 'creator')`, then `can_add_members = true`. This is the most reliable static check without making live Telegram API calls for every group.

2. **Single batch job design preserved.** The endpoint creates one `AgentJob` with `job_type="member_add"` and all user IDs in the payload. The worker iterates sequentially with `interval_seconds` between adds. No change to this architecture.

3. **Frontend progress uses `payload.details` array.** After execution, `_handle_member_add_job` stores `results["details"]` — a list of per-user `{user_id, success, error_code, flood_wait_seconds, skipped}` objects. The frontend job detail view will read this from `job.job_payload.result.details`.

4. **Invite-link fallback for privacy-restricted users.** When direct add fails with `USER_PRIVACY_RESTRICTED` AND `send_invite_link_on_privacy_restricted=true` (per-job setting, default `false`), the worker exports an invite link for the target group and DMs it to the user. The link is cached per-agent-per-group with a 24h TTL to avoid redundant API calls. This is a new code path in `group_membership.py` + a new branch in the worker's add loop.

5. **Setting location: per-job field in `BulkMemberAddRequest`.** The `send_invite_link_on_privacy_restricted: bool` flag is part of the request payload, not an agent-level setting. Rationale: sending DMs to strangers is a conscious decision the user makes for each batch. Default `false` for safety.

## Task List

### Phase 1: Fix the Blocker (1 task)

- [ ] Task 1: Add `can_add_members` to agent group listing

### Checkpoint: Blocker Fixed
- [ ] Target group dropdown is populated in the bulk-add modal
- [ ] End-to-end flow works: select target group → search members → queue job

### Phase 2: Frontend Progress Tracking (2 tasks)

- [ ] Task 2: Add per-user result detail to frontend job list view
- [ ] Task 3: Surface job progress in real-time during execution

### Checkpoint: Tracking Works
- [ ] Completed jobs show per-user success/skip/failure breakdown
- [ ] In-progress jobs show progress (X of Y completed)

### Phase 3: Invite-Link Fallback for Privacy-Restricted Users (2 tasks)

- [ ] Task 4: Populate `can_add_members` via live Telegram admin check fallback
- [ ] Task 5: Add invite-link fallback with user-controllable setting

### Checkpoint: Complete
- [ ] All acceptance criteria met
- [ ] Linting passes
- [ ] Tests pass

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `telegram_user_id` is null on some agents | Med — those agents can't use bulk-add | `can_add_members` returns `false` when `telegram_user_id` is null |
| `scraped_members` may not have the agent's own record | Med — stale scrapes | Query directly via Telethon if static check fails (Part 3 fallback) |
| Large groups with 500+ user_ids cause slow execution | Low — intentional sequential design | Already handled with `interval_seconds` and flood-wait retry |

## Open Questions

- Should we show a "not admin" warning when `can_add_members` is false for all groups?
- Should the UI distinguish between "can't add (not admin)" and "permission unknown (no data)"?
