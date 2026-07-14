# Task List: Bulk Add Members Backend Wiring + Tracking UI

## Phase 1: Fix the Blocker

### Task 0: Fix browser dashboard account linking boundary

**Description:** The browser dashboard's account linking calls (`/webapp/agents/auth/start`, `/auth/code`, `/auth/password`) don't send `X-App-Boundary: agents`, causing 403 errors for non-owner users. Add `boundary: "agents"` to the three `apiRequest` calls so normal users can link accounts from the dashboard.

**Acceptance criteria:**
- [ ] Non-owner users can link a Telegram account via the browser dashboard
- [ ] Bot owners still bypass the boundary check (unchanged behavior)

**Verification:**
- [ ] Open browser dashboard → go to Agents → click Link Account → enter phone → code → password → agent appears as active

**Dependencies:** None

**Files likely touched:**
- `bot/dashboard/frontend/index.html`

**Estimated scope:** XS (1 file, 3 lines changed)

---

### Task 1: Add `can_add_members` to agent group listing

**Description:** Modify `AccountGroupMembershipService.list_managed_member_groups()` to return a `can_add_members: bool` field for each group. This field is `true` when the agent's `telegram_user_id` has an admin/creator role in the group's `scraped_members` table. This unblocks the frontend, which filters on this field.

**Acceptance criteria:**
- [ ] `list_managed_member_groups()` returns `can_add_members` for every group
- [ ] Field is `true` when `scraped_members` has a record with the agent's `telegram_user_id` and `role IN ('admin', 'creator')` for that group's `tg_group_id`
- [ ] Field is `false` when no admin/creator record exists, or when `agent.telegram_user_id` is null
- [ ] Existing fields (id, tg_group_id, title, etc.) are unchanged
- [ ] Performance: a single batched query computes permissions for all groups, not N+1 queries

**Verification:**
- [ ] Run `GET /webapp/agents/{agent_id}/groups` and verify `can_add_members` is present
- [ ] Target group dropdown in the bulk-add modal is populated with groups where `can_add_members` is true
- [ ] Lint passes: `ruff check bot/`
- [ ] Existing tests pass: `docker compose run --rm backend pytest -x -k "member or group"`

**Dependencies:** None

**Files likely touched:**
- `bot/agents/account_group_membership_service.py`

**Estimated scope:** Small (1 file)

---

## Checkpoint: Blocker Fixed
- [ ] Target group dropdown is populated
- [ ] Submitting the form creates an `AgentJob` with `job_type=member_add`
- [ ] Job executes and members are added
- [ ] Notifications appear on completion

---

## Phase 2: Frontend Progress Tracking

### Task 2: Show per-user results in job detail view

**Description:** Enhance the dashboard frontend job listing to show a per-user breakdown when viewing a completed `member_add` job. Read the `details` array from `job.job_payload.result.details` and render success/failure/skipped counts with a detail expander.

**Acceptance criteria:**
- [ ] A completed `member_add` job shows "Added X of Y members, Z skipped, W failed" summary
- [ ] Clicking the job expands a per-user list showing user_id, result (success/skipped/failed), and error code if applicable
- [ ] The UI matches the existing bulk messaging job detail pattern
- [ ] Translation keys are added for member-add-specific labels

**Verification:**
- [ ] Run a member_add job with 3+ users including one that fails → see per-user results in UI
- [ ] No console errors

**Dependencies:** Task 1

**Files likely touched:**
- `bot/dashboard/frontend/index.html`

**Estimated scope:** Medium (1 file, ~50-80 lines of JS/HTML)

---

### Task 3: Surface live job progress during execution

**Description:** Show live progress for a running `member_add` job in the dashboard. The `_handle_member_add_job()` function updates `payload.progress` with `{success_count, failure_count, skipped_count, total_count, completed, remaining}`. The frontend polls job status and displays this progress.

**Acceptance criteria:**
- [ ] Running `member_add` jobs show "X of Y members processed" with a progress indicator
- [ ] Progress refreshes periodically (every 5-10 seconds)
- [ ] On completion, progress display transitions to the completed result view from Task 2
- [ ] Matches existing bulk messaging progress pattern

**Verification:**
- [ ] Queue a member_add job with 10+ users → see progress updating in real-time
- [ ] Job shows progress even when interrupted by flood-wait

**Dependencies:** Task 2

**Files likely touched:**
- `bot/dashboard/frontend/index.html`

**Estimated scope:** Medium (1 file, ~40-60 lines of JS)

---

## Phase 3: Invite-Link Fallback for Privacy-Restricted Users

### Task 4: Live admin-check fallback for `can_add_members`

**Description:** When the static `scraped_members` check returns fresh enough data, use it. When the entity is not found indicating that data from scraped members might be stale, optionally fall back to a live Telegram API call using the agent's client to check if the agent has admin rights in the target group. This is a best-effort enhancement and should not block the primary flow.

**Acceptance criteria:**
- [ ] A new service method `check_agent_can_add_members(tg_group_id) -> bool` is added
- [ ] Uses Telethon `GetParticipantsRequest` with admin filter to verify agent admin status
- [ ] Falls back to cached `scraped_members` check if live call fails
- [ ] Results are cached per-agent-per-group with a configurable TTL (default 5 minutes)
- [ ] Not called during group listing (would be too slow) — only used when user opens the bulk-add modal

**Verification:**
- [ ] When admin role is removed on Telegram, the check eventually reflects the change
- [ ] No performance regression on group listing page

**Dependencies:** Task 1

**Files likely touched:**
- `bot/agents/account_group_membership_service.py`
- `bot/agents/group_membership.py`

**Estimated scope:** Medium (2 files)

---

### Task 5: Add invite-link fallback with user-controllable setting

**Description:** When direct add fails with `USER_PRIVACY_RESTRICTED`, the system can fall back to sending an invite link via DM instead of recording a plain failure. This is controlled by a new `send_invite_link_on_privacy_restricted: bool` field in `BulkMemberAddRequest` (default `false`). When enabled, the worker exports an invite link for the target group via `messages.exportChatInvite`, caches it (24h TTL), sends it to the user via DM, and records the result as `invite_link_sent`.

**Acceptance criteria:**
- [ ] `BulkMemberAddRequest` gains `send_invite_link_on_privacy_restricted: bool = Field(default=False)`
- [ ] The POST endpoint passes this field into the job payload
- [ ] `group_membership.py` has a new `export_group_invite_link(client, group_id) -> str` function using `messages.exportChatInvite`
- [ ] `_handle_member_add_job()` checks the flag on `USER_PRIVACY_RESTRICTED`:
  - If `true`: export link → send DM → record `{"success": True, "method": "invite_link"}`
  - If `false`: record plain failure (existing behavior)
- [ ] Invite links are cached per-agent-per-group with 24h TTL (avoid redundant exports)
- [ ] If the invite link DM also fails, record `{"method": "invite_link_dm_failed", "error_code": "..."}` as a failure
- [ ] Frontend form has a checkbox for "Send invite link if privacy restricted" (default unchecked)
- [ ] Job detail view shows `invite_link_sent` vs `direct_add` vs `failed` per user
- [ ] `MembershipAuditLog` records the method used (direct_add / invite_link)

**Verification:**
- [ ] Run a job with the checkbox ON targeting privacy-restricted users → invite link sent, not plain failure
- [ ] Run a job with the checkbox OFF → behavior unchanged (plain failure)
- [ ] Repeated adds for same target group use cached invite link (second call doesn't re-export)
- [ ] Lint passes: `ruff check bot/`

**Dependencies:** Task 1

**Files likely touched:**
- `bot/dashboard/api/routers/_shared.py` (add field to model)
- `bot/dashboard/api/routers/agents.py` (pass field to job payload)
- `bot/agents/group_membership.py` (new `export_group_invite_link()`)
- `bot/agents/worker.py` (invite-link fallback in add loop)
- `bot/dashboard/frontend/index.html` (checkbox + result display)

**Estimated scope:** Medium (5 files)

---

## Verification

Before merging, confirm:
- [ ] Blocker is fixed: target group dropdown is populated
- [ ] End-to-end flow: select agent → pick target group → search members → select users → queue job → job executes → completion notification → per-user results visible
- [ ] Linting passes: `ruff check bot/`
- [ ] Tests pass: `docker compose run --rm backend pytest -x`
- [ ] Translations for any new UI labels are added (English + Arabic)
