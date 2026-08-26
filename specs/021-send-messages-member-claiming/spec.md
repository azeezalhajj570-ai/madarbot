# Feature Specification: Member Claiming for Send Messages to Group Members

**Status**: Implemented
**Branch**: `feature/021-send-messages-member-claiming`

## Goal

Make **Send Messages to Group Members** use the **same member-claiming
mechanism as Bulk Add Members**. The user picks one agent, selects members,
claims them for that agent, and sends messages to the members claimed by that
agent. No new claiming system and no multi-agent selector.

## Workflow

```text
Select Agent
      ↓
Select Members
      ↓
Claim Members
      ↓
Send Messages
```

Multiple agents are supported naturally by repeating the claim operation.

## Architecture

```text
                  Member Claim (shared)
                       │
             ┌─────────┴─────────┐
             │                   │
          Bulk Add          Send Messages
             │                   │
        Add Member          Send Message
```

Only the action after claiming differs. The claim system is shared verbatim:
`MemberClaim` model, `claim_members` / `release_claims` services, the member-list
claim annotation, the `claim_ids`-in-payload + runtime release pattern, and the
`AgentJob` + Dramatiq worker pipeline.

## Requirements (FR-001 … FR-021)

| FR | Requirement | Implementation |
|----|-------------|----------------|
| FR-001 | Reuse Bulk Add claiming | Same `claim_members` / `release_claims` / `MemberClaim` / partial-unique-index semantics. |
| FR-002 | Same agent selection | Single agent per request (URL path param); no multi-agent selector anywhere. |
| FR-003 | Select members | Claim-aware member picker in the miniapp CampaignsPage. |
| FR-004 | Claim members | `POST /api/agents/{id}/claims` calls `claim_members`. |
| FR-005 | Multiple agents via repeated claims | Claim endpoint is idempotent per (tenant, member); repeat with another agent. |
| FR-006 | Send uses claims | `POST /api/agents/{id}/claimed-send` verifies each recipient's active claim belongs to the agent. |
| FR-007 | Claim is the source of ownership | The send job only includes members claimed by that agent; the runtime never re-resolves ownership. |
| FR-008 | Bulk Add and Send share claiming | One `MemberClaim` row is consumed by both `member_add` and `send_to_claimed_members` jobs. |
| FR-009 | No automatic reassignment | Sending never mutates a claim; failures leave the claim on the same agent. |
| FR-010 | Existing claim rules apply | Reject-on-conflict, workspace scoping, release ownership all inherited from `member_claim_service`. |
| FR-011 | Workspace isolation | Backend validates `tenant_id` on every claim read/write and the agent belongs to the workspace (`ensure_agent_admin`); the miniapp sends `X-Workspace-Id`. |
| FR-012 | Existing claimed members | Already-claimed members are reported as conflicts, never silently reassigned. |
| FR-013 | Send task recipient resolution | Endpoint groups recipients by their claimed agent (one job per agent; this endpoint is single-agent, so one job). |
| FR-014 | Agent-specific execution | The job row carries `agent_id`; the worker uses that agent's Telethon session. |
| FR-015 | Reuse agent job infrastructure | New `send_to_claimed_members` job type runs through `execute_agent_job` + Dramatiq. |
| FR-016 | One Send Messages task | The user creates one job per agent; multi-agent is multiple jobs (one per agent's claim set). |
| FR-017 | Agent failure isolation | A failed send stops that job; other agents' jobs are unaffected; claims stay. |
| FR-018 | Telegram errors recorded per member | Per-member `failures`/progress entries; the loop continues. |
| FR-019 | Rate limiting preserved | `AgentRateLimiter` (cooldown/hourly/daily/min-delay) enforced per agent in the runtime + preflight. |
| FR-020 | Retry uses the same claimed agent | Retry re-dispatches the same job (same `agent_id`); claims are not reassigned. |
| FR-021 | Unclaimed members rejected | `claimed-send` returns `{"status": "conflicts", "unclaimed": [...]}` and creates no job. |

## API

### `POST /api/agents/{agent_id}/claims` (+ `/webapp/...`)

```json
{ "source_tg_group_id": 123456789, "user_ids": [111, 222] }
```

```json
{
  "status": "ok",
  "claimed": [111],
  "conflicts": [{ "tg_user_id": 222, "claimed_by_agent_id": 8, "expires_at": "..." }]
}
```

### `DELETE /api/agents/{agent_id}/claims` (+ `/webapp/...`)

```json
{ "claim_ids": [11, 12] }
```

```json
{ "status": "ok", "released": 2 }
```

### `POST /api/agents/{agent_id}/claimed-send` (+ `/webapp/...`)

```json
{
  "source_tg_group_id": 123456789,
  "user_ids": [111, 222],
  "messages": ["Hello"],
  "media_urls": [null],
  "interval_seconds": 5,
  "interval_between_contacts": 5
}
```

- Success: `{"status": "ok", "job": {id, agent_id, job_type, status, user_count, source_tg_group_id}}`
- Conflicts: `{"status": "conflicts", "unclaimed": [...], "claimed_by_other": [...]}` (no job created)

## Job Type

- Constant: `SEND_TO_CLAIMED_MEMBERS_JOB_TYPE = "send_to_claimed_members"`
- Normalizer: `normalize_send_to_claimed_members_payload` (messages required;
  source_group_id required; ≥1 user_id; interval fields; media_urls aligned).
- Payload stores `claim_ids` (released by the runtime `finally`).

## Files Changed

- `bot/agents/jobs.py` — job type constant + payload normalizer.
- `bot/dashboard/api/routers/_shared.py` — `ClaimMembersRequest`,
  `ReleaseClaimsRequest`, `SendToClaimedMembersRequest`.
- `bot/dashboard/api/routers/agents.py` — `POST/DELETE /claims` +
  `POST /claimed-send` (mirror `webapp_bulk_add_members` auth/claim pattern).
- `bot/agents/agent_job_service.py` — `create_job` branch (normalize + skip
  ownership exclusions + broadcast rate-limit preflight) and
  `_job_queued_notification` mapping.
- `bot/agents/runtime.py` — `SendToClaimedMembersRuntime` (broadcast send loop +
  bulk-add claim-release `finally`).
- `bot/agents/worker.py` — dispatch branch (partial-reschedule on `stopped_at`,
  complete/fail logic) + notification branch.
- `bot/agents/account_group_membership_service.py` — `can_send_messages` field
  on the group listing.
- `packages/miniapp-shared/src/types/index.ts` — `can_send_messages`,
  `ClaimResult`, `ClaimConflict`.
- `packages/miniapp-shared/src/api/base.ts` — `deleteWithBody` helper.
- `packages/miniapp-shared/src/api/agents.ts` — `claimMembers`,
  `releaseClaims`, `sendToClaimedMembers`.
- `apps/miniapp-agents/src/pages/CampaignsPage.tsx` — claim-aware member
  picker, Claim/Release buttons, claimed-send submission.
- `apps/miniapp-agents/src/App.tsx` — pass `workspaceId` to `CampaignsPage`.
- `apps/miniapp-agents/src/i18n/locales/{en,ar}.json` — new labels.
- `tests/test_member_claim_service.py` (new), `tests/test_send_claimed_members.py` (new).

## Non-Goals

- No new claiming system.
- No multi-agent selector.
- No auto-distribution or rotation of agents.
- No auto-reassignment after failures.
- Bulk Add claiming behavior is unchanged.
- Legacy `bot/dashboard/frontend/index.html` and `dashboard/src` UIs are out of
  scope for this iteration (miniapp is the canonical frontend).
