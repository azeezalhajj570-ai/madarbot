# Implementation Plan: Member Claiming for Send Messages to Group Members

**Branch**: `feature/021-send-messages-member-claiming`
**Spec**: `specs/021-send-messages-member-claiming/spec.md`

## Task 1: Backend job plumbing

- `bot/agents/jobs.py`: add `SEND_TO_CLAIMED_MEMBERS_JOB_TYPE` and
  `normalize_send_to_claimed_members_payload`.
- `bot/agents/agent_job_service.py`: `create_job` branch — normalize, skip
  ownership exclusions (claims are the ownership), run the broadcast rate-limit
  preflight; `_job_queued_notification` title/count.

## Task 2: Claim + send endpoints

- `bot/dashboard/api/routers/_shared.py`: `ClaimMembersRequest`,
  `ReleaseClaimsRequest`, `SendToClaimedMembersRequest`.
- `bot/dashboard/api/routers/agents.py`:
  - `POST /api/agents/{id}/claims` → `claim_members` (returns claimed + conflicts).
  - `DELETE /api/agents/{id}/claims` → `release_claims` (agent+tenant scoped).
  - `POST /api/agents/{id}/claimed-send` → verify every recipient's active claim
    belongs to the agent; unclaimed/other-agent → conflict report, no job;
    else create job, persist `claim_ids`, dispatch.

## Task 3: Runtime + worker

- `bot/agents/runtime.py`: `SendToClaimedMembersRuntime` — per-member rate
  limiting, `SentBroadcastMessage` pending→sent dedup, send, per-member results,
  checkpointing, `finally: release_claims`.
- `bot/agents/worker.py`: dispatch branch (partial-reschedule on `stopped_at`,
  complete/fail with "All messages failed to send") + `_build_job_notification`
  branch (`send_messages_completed` / `send_messages_failed`).

## Task 4: Group listing

- `bot/agents/account_group_membership_service.py`: `can_send_messages` (= is_member).

## Task 5: Shared package + miniapp

- `packages/miniapp-shared/src/types/index.ts`: `can_send_messages`, `ClaimResult`,
  `ClaimConflict`.
- `packages/miniapp-shared/src/api/base.ts`: `deleteWithBody`.
- `packages/miniapp-shared/src/api/agents.ts`: `claimMembers`, `releaseClaims`,
  `sendToClaimedMembers`.
- `apps/miniapp-agents/src/App.tsx`: pass `workspaceId`.
- `apps/miniapp-agents/src/pages/CampaignsPage.tsx`: claim-aware member picker,
  Claim/Release buttons, members-mode send → `sendToClaimedMembers`, conflict
  handling; i18n keys (en/ar).

## Task 6: Tests

- `tests/test_member_claim_service.py`: claim semantics, conflicts, workspace
  isolation, scoped release, expiry.
- `tests/test_send_claimed_members.py`: normalizer + runtime (send via agent
  client, per-member failure, claim survives failure, claims released, unclaimed
  not sent).

## Task 7: Docs + verify

- `specs/021-send-messages-member-claiming/` (spec/plan/tasks) + AGENTS.md.
- Backend tests in the ephemeral container; frontend `tsc --noEmit`; `ruff check`.
