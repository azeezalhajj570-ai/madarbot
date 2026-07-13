# Feature Specification: Bulk Add Members — Backend Wiring + Tracking UI

**Feature Branch**: `060-bulk-add-members-orchestration`

**Created**: 2026-07-13

**Status**: Draft

**Input**: User description: "Bulk Add Members: wire up missing backend orchestration + add tracking UI"

## User Scenarios & Testing

### User Story 1 — Agent adds members from source group to target group (P1)

As a MadarBot user with a linked Telegram account (agent),
I want to select members from a source group I've scraped and add them to another group where my agent is admin,
So that I can grow my target group with relevant members.

**Why this priority**: This is the core workflow. Without it, the feature is unusable — the frontend UI exists but the target group dropdown is always empty because `can_add_members` is never returned.

**Independent Test**: Can be fully tested by:
1. Opening the Bulk Add Members modal
2. Selecting an agent
3. Verifying the target group dropdown is populated with groups where the agent is admin
4. Selecting members and queuing the job
5. Verifying members appear in the target group

**Acceptance Scenarios**:

1. **Given** an agent with admin rights in at least one group, **When** I open the Bulk Add Members modal, **Then** the target group dropdown shows those groups (filtered by `can_add_members: true`).

2. **Given** I have selected a source group and searched for members, **When** I select members and submit the form with valid parameters, **Then** a `member_add` AgentJob is created with status `pending`.

3. **Given** a `member_add` job is running, **When** the worker iterates through user IDs, **Then** `add_user_to_group()` is called sequentially with the configured `interval_seconds` delay between each attempt.

4. **Given** a target user is already in the group, **When** the worker attempts to add them, **Then** the result is recorded as `skipped` with reason `already_member`, not counted as a failure.

5. **Given** the job completes, **When** all users have been processed, **Then** a notification is created with summary ("Added X of Y members, Z skipped, W failed").

---

### User Story 2 — Agent sends invite links to privacy-restricted users (P1)

As a MadarBot user,
I want the system to fall back to sending an invite link via DM when a user can't be added directly due to privacy settings,
So that I can still invite privacy-restricted users to my group instead of losing them as failures.

**Why this priority**: `USER_PRIVACY_RESTRICTED` is the most common non-flood error when adding members. Without this fallback, every privacy-restricted user is a permanent failure. With it, the user can still be reached.

**Independent Test**: Can be tested by adding a user with strict privacy settings while `send_invite_link_on_privacy_restricted=true` — the job shows "invite_link_sent" instead of "failed".

**Acceptance Scenarios**:

1. **Given** a bulk-add job with `send_invite_link_on_privacy_restricted=true`, **When** a user triggers `USER_PRIVACY_RESTRICTED`, **Then** the system exports an invite link for the target group and sends it to the user via DM.

2. **Given** a bulk-add job with `send_invite_link_on_privacy_restricted=false` (default), **When** a user triggers `USER_PRIVACY_RESTRICTED`, **Then** the result is recorded as a plain failure, no DM is sent.

3. **Given** the invite link DM was sent successfully, **When** the job completes, **Then** the per-user result shows `status: "invite_link_sent"` with the link preview.

4. **Given** the user also blocks DMs from the agent (`premium_required_for_pm`), **When** the fallback tries to send an invite link, **Then** the result records `"invite_link_dm_failed"`.

---

### User Story 3 — User sees per-user results for completed jobs (P2)

As a MadarBot user,
I want to see a breakdown of each add attempt (which users succeeded, which failed, and why),
So that I can understand what happened and retry failures if needed.

**Why this priority**: Without per-user visibility, the user can't diagnose failures or know which members need alternative invite methods (invite links, DMs).

**Independent Test**: Can be tested by viewing a completed `member_add` job's detail view and seeing a per-user result list with status indicators.

**Acceptance Scenarios**:

1. **Given** a completed `member_add` job, **When** I view its details, **Then** I see success/skip/failure counts and an expandable list of per-user results.

2. **Given** a user failed due to `USER_PRIVACY_RESTRICTED`, **When** I view the job details, **Then** I see the error code and a suggestion to use an invite link instead.

3. **Given** the job was interrupted by flood-wait and re-queued, **When** I view job progress, **Then** I see "X of Y users processed" with a partial completion indicator.

---

### User Story 4 — Premium user bypasses privacy restrictions (P3)

As a MadarBot user with a Telegram Premium account linked as an agent,
I want premium-related invite results to be surfaced,
So that I know when upgrading to Premium would allow adding privacy-restricted users.

**Why this priority**: Telegram returns `MissingInvitee` flags (`premium_would_allow_invite`) when a Premium account could bypass privacy settings. This enhances the feature but doesn't block the core flow.

**Independent Test**: Can be tested by verifying the `missing_invitees` processing logic in `_handle_member_add_job()` when Telegram returns these flags.

**Acceptance Scenarios**:

1. **Given** Telegram returns `missingInvitee` with `premium_would_allow_invite`, **When** the worker processes the result, **Then** the error is recorded with a "Premium would allow invite" flag in the details.

2. **Given** a user couldn't be added due to privacy, **When** the agent has Premium and direct add succeeds, **Then** no fallback is needed — the API handles it.

---

### Edge Cases

- What happens when the agent's `telegram_user_id` is null? → `can_add_members` is `false` for all groups, modal shows no target groups.
- What happens when no groups have been scraped yet? → `list_managed_member_groups()` returns empty list, target dropdown has no options.
- What happens when the target group reaches its member limit (200 for basic groups, 200K for supergroups)? → Telegram returns `USERS_TOO_MUCH`; worker records failure per user.
- What happens when a user was previously kicked from the target group? → `USER_KICKED` error; recorded as failure.
- What happens when the agent's session expires mid-job? → `AgentSessionRevokedError` caught; job marked as failed with partial progress saved.
- What happens with flood-wait during the add loop? → Current code raises `AgentFloodWaitError`, saves progress, and re-queues job with `retry_after` delay.
- What happens with `USER_CHANNELS_TOO_MUCH`? → User is in too many channels; recorded as failure with clear error code.
- What happens when `send_invite_link_on_privacy_restricted=true` but the agent can't DM the user? → Telegram raises privacy error on DM send; recorded as `invite_link_dm_failed`.
- What happens when `send_invite_link_on_privacy_restricted=true` but the agent is not admin in the target group? → Invite link export requires admin rights; falls back to plain failure.
- What happens when the invite link export itself hits a flood-wait? → Exported link is cached and retried; if repeated failure, recorded as failure.

## Requirements

### Functional Requirements

- **FR-001**: System MUST return a `can_add_members: bool` field for each group in the agent group listing endpoint (`GET /webapp/agents/{id}/groups`). The field is `true` when the agent's `telegram_user_id` has admin/creator role in the group's `scraped_members` table, `false` otherwise.
- **FR-002**: System MUST accept `POST /webapp/agents/{id}/member-adds` with a `BulkMemberAddRequest` body containing `target_tg_group_id`, `interval_seconds`, `user_ids`, and optional `send_invite_link_on_privacy_restricted` (default `false`).
- **FR-003**: System MUST create a single `AgentJob` with `job_type="member_add"` per request, containing all user IDs in the payload.
- **FR-004**: System MUST process user additions sequentially with `interval_seconds` delay between each attempt.
- **FR-005**: System MUST handle Telegram error codes: `USER_ALREADY_PARTICIPANT` (skip), `USER_PRIVACY_RESTRICTED` (fail or fallback), `USER_KICKED` (fail), `USER_CHANNELS_TOO_MUCH` (fail), `USERS_TOO_MUCH` (fail), `FLOOD_WAIT_X` (pause and retry).
- **FR-005b**: When `USER_PRIVACY_RESTRICTED` occurs AND `send_invite_link_on_privacy_restricted=true`, system MUST fall back to: (1) export invite link for target group via `messages.exportChatInvite`, (2) send the link to the user via DM, (3) record result as `invite_link_sent`.
- **FR-005c**: When invite link DM also fails (user blocks DMs), system MUST record result as `invite_link_dm_failed` with the DM error code.
- **FR-006**: System MUST write to `MembershipAuditLog` for every add attempt (success, skip, failure, or invite_link_sent).
- **FR-007**: System MUST create a `GroupMember` record with `source="membership_add"` on successful addition.
- **FR-008**: System MUST send a completion notification with summary counts (success, skipped, failed, total).
- **FR-009**: System MUST store per-user results in `job_payload.result.details` as an array of `{user_id, success, error_code?, flood_wait_seconds?, skipped?, method?}`. When invite link fallback is used, `method` is `"invite_link"` and `success` is `true`.
- **FR-010**: Frontend MUST display per-user results for completed `member_add` jobs from the `details` array.
- **FR-011**: Frontend MUST show live progress for running `member_add` jobs (X of Y processed) with polling.
- **FR-012**: System MUST respect the `require_active_subscription` dependency for the member-adds endpoint.
- **FR-013**: System MUST handle `MissingInvitee` result flags: `premium_would_allow_invite`, `premium_required_for_pm`.
- **FR-014**: System MUST provide a `send_invite_link_on_privacy_restricted: bool` setting (default `false`) in the `BulkMemberAddRequest` payload, controllable per job from the frontend checkbox.
- **FR-015**: System MUST cache exported invite links per group with a configurable TTL (default 24 hours) to avoid re-exporting on every privacy-restricted user.

### Key Entities

- **`BulkMemberAddRequest`**: Request model with `target_tg_group_id`, `interval_seconds`, `user_ids[]`, `send_invite_link_on_privacy_restricted: bool` (default `false`).
- **`AgentJob` (member_add)**: Background job storing `target_tg_group_id`, `interval_seconds`, `user_ids[]`, `requested_by`, `send_invite_link_on_privacy_restricted` in payload. Progress tracks `{success_count, failure_count, skipped_count, total_count, completed, remaining}`. Result stores `{details: [{user_id, success, error_code?, method?}]}`.
- **`GroupMember`**: Created per successful add with `source="membership_add"`, linking `group_id` to `tg_user_id` with `role="member"`.
- **`MembershipAuditLog`**: Immutable audit trail per add attempt — stores `group_id`, `user_id`, `requested_by`, `action="add"`, `result` (success/error_code/method), `flood_wait_sec`.
- **Invite link cache**: Per-agent-per-target-group, stored in Redis or in-memory dict with TTL (24h default). Avoids redundant `messages.exportChatInvite` calls.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Target group dropdown in the bulk-add modal is populated with groups where `can_add_members=true` (currently always empty — fixing this is the primary success metric).
- **SC-002**: A `member_add` job with 50 user IDs completes within `50 × interval_seconds` (roughly 17 minutes at 20s interval) assuming no flood-waits.
- **SC-003**: Per-user results (success/skip/fail) are visible in the job detail view within 1 second of job completion.
- **SC-004: Zero regressions** in existing bulk messaging, scraping, and agent management flows.

## Assumptions

- The agent's `telegram_user_id` is populated and accurate (or `can_add_members` returns `false` for all groups).
- The agent has been scraped at least once so `scraped_members` contains role data for the groups it manages.
- The `interval_seconds` default of 20 seconds is sufficient to avoid aggressive flood-waits from Telegram.
- The target group does not exceed Telegram's member limits during the job (basic group: 200, supergroup: 200K, gigagroup: unlimited).
- The frontend polling interval for job progress is 5-10 seconds (matching existing bulk messaging pattern).
- Telegram's `fwd_limit` parameter in `messages.addChatUser` defaults to reasonable value (current implementation does not specify one).
- Telethon repository has moved from GitHub to Codeberg (https://codeberg.org/Lonami/Telethon) — no functional impact.
