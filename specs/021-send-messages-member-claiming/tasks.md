# Implementation Tasks

## Backend

- [x] `SEND_TO_CLAIMED_MEMBERS_JOB_TYPE` constant + payload normalizer (jobs.py).
- [x] Request schemas: `ClaimMembersRequest`, `ReleaseClaimsRequest`,
      `SendToClaimedMembersRequest` (_shared.py).
- [x] `POST /api/agents/{id}/claims` — reuses `claim_members`; conflicts rejected.
- [x] `DELETE /api/agents/{id}/claims` — reuses `release_claims` (agent+tenant scoped).
- [x] `POST /api/agents/{id}/claimed-send` — verifies claims, rejects unclaimed,
      persists `claim_ids`, dispatches job.
- [x] `create_job` branch for `send_to_claimed_members` (normalize + rate-limit
      preflight; no ownership exclusions).
- [x] `_job_queued_notification` mapping for the new type.
- [x] `SendToClaimedMembersRuntime` (rate limiting, dedup, per-member results,
      checkpointing, claim release in `finally`).
- [x] Worker dispatch branch + `send_messages_completed/failed` notifications.
- [x] `can_send_messages` field on the group listing.

## Shared package + frontend

- [x] `can_send_messages`, `ClaimResult`, `ClaimConflict` types.
- [x] `deleteWithBody` apiClient helper.
- [x] `claimMembers` / `releaseClaims` / `sendToClaimedMembers` client functions.
- [x] `App.tsx` passes `workspaceId` to `CampaignsPage`.
- [x] `CampaignsPage`: claim-aware member list, Claim/Release buttons, members
      mode send via claimed-send with conflict handling.
- [x] i18n keys (en/ar).

## Tests

- [x] `tests/test_member_claim_service.py`: claim new members, conflict on
      double-claim, workspace isolation, scoped release, expiry.
- [x] `tests/test_send_claimed_members.py`: normalizer, send via agent client,
      per-member failure, claim survives failure, claims released, unclaimed not
      sent.

## Verification

- [ ] Run backend tests in the ephemeral test container.
- [ ] `tsc --noEmit` for `apps/miniapp-agents` and `packages/miniapp-shared`.
- [ ] `ruff check` on changed Python files.
