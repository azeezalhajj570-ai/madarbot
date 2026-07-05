# Feature Specification: Agent Job Resilience & Smart Dispatch

**Feature Branch**: `008-agent-job-resilience`

**Created**: 2026-07-05

**Status**: Draft

**Input**: Investigation findings showing only 1 of 5 active agents successfully sending messages due to stuck jobs, inaccessible group assignments, missing progress checkpointing, excessive send intervals, and lack of auto-dispatch.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Progress Checkpointing: Resume Broadcasts After Failure (Priority: P1)

As an agent admin, I want broadcast jobs to persist their progress to the database during execution, so that if a job hits the 24-hour Dramatiq time limit or crashes, it can resume from where it left off instead of restarting from scratch.

**Why this priority**: Without checkpointing, a 500-contact broadcast with 25-minute intervals (208 hours expected) will hit the 24-hour time limit, lose all progress, and restart — creating an infinite loop of partial sends. This is the single highest-impact fix.

**Independent Test**: Can be fully tested by starting a broadcast job, killing the worker process mid-execution, restarting the worker, and verifying the job resumes from the last checkpoint (not from the beginning). The `job_payload.progress` field in the database must contain `sent_users`, `success_count`, and `failure_count`.

**Acceptance Scenarios**:

1. **Given** a broadcast job that has sent messages to 50 contacts, **When** the worker process crashes, **Then** the database contains `job_payload.progress.sent_users` with all 50 recipient IDs.
2. **Given** a broadcast job with existing progress in `job_payload`, **When** the job is re-executed, **Then** it skips recipients already in `sent_users` and resumes from the next unsent contact.
3. **Given** a broadcast job running normally, **When** 10 messages have been sent since the last checkpoint, **Then** progress is persisted to the database.
4. **Given** a broadcast job running normally, **When** 60 seconds have elapsed since the last checkpoint, **Then** progress is persisted to the database regardless of message count.
5. **Given** a broadcast job that completed successfully, **When** viewing the job result, **Then** `progress.final_success_count` and `progress.final_failure_count` reflect the total across all checkpoint cycles.

---

### User Story 2 — Smart Interval Strategy: Graduated Send Delays (Priority: P1)

As an agent admin, I want broadcast jobs to use graduated delays between messages instead of a fixed 25-40 minute interval, so that broadcasts complete in hours instead of days while still avoiding Telegram FloodWait errors.

**Why this priority**: The current fixed interval of 1500-2400 seconds makes a 500-contact broadcast take 200+ hours. A graduated strategy sends the first batch quickly (proving the agent works) and gradually increases delays to stay under Telegram's radar. This directly addresses the "only one agent appears to work" complaint.

**Independent Test**: Can be tested by creating a broadcast job with 100 recipients and verifying that the first 50 messages are sent with ~30s delays, the next 50 with ~60s delays, and the job completes in under 2 hours (vs 42+ hours with fixed 1500s intervals).

**Acceptance Scenarios**:

1. **Given** a broadcast job with the default interval strategy, **When** sending the first 50 contacts, **Then** the delay between sends is 30 seconds (±10% jitter).
2. **Given** a broadcast job with the default interval strategy, **When** sending contacts 51-100, **Then** the delay between sends is 60 seconds (±10% jitter).
3. **Given** a broadcast job with the default interval strategy, **When** sending contacts 101-200, **Then** the delay between sends is 120 seconds (±10% jitter).
4. **Given** a broadcast job with the default interval strategy, **When** sending contacts 201-400, **Then** the delay between sends is 180 seconds (±10% jitter).
5. **Given** a broadcast job with the default interval strategy, **When** sending contacts 401+, **Then** the delay between sends is 300 seconds (±10% jitter).
6. **Given** a user specifies a custom `interval_between_contacts` in the job payload, **When** the broadcast runs, **Then** the custom interval is used (backward compatible).
7. **Given** the graduated strategy is active, **When** a 500-contact broadcast runs, **Then** it completes in approximately 4-6 hours instead of 200+ hours.

---

### User Story 3 — Group Accessibility Validation: Prevent Silent Failures (Priority: P1)

As an agent admin, I want the system to validate that an agent can access the target groups before dispatching a broadcast job, so that I get immediate feedback when a group is inaccessible instead of a job that "succeeds" with zero messages sent.

**Why this priority**: Agent 13's jobs complete in under 1 second because its assigned groups are inaccessible — `iter_participants` returns 0 recipients. The user sees "completed" status and assumes messages were sent. This validation prevents false confidence and wasted job slots.

**Independent Test**: Can be tested by creating a broadcast job targeting a group the agent has not joined, and verifying the API returns a 422 error with a clear message listing the inaccessible groups.

**Acceptance Scenarios**:

1. **Given** an agent that has not joined Group X, **When** I create a broadcast job targeting Group X, **Then** the API returns 422 with `{"detail": "Agent cannot access groups: [Group X]. Ensure the agent has joined these groups."}`.
2. **Given** an agent that has joined Group X and Group Y, **When** I create a broadcast job targeting both, **Then** the job is created and dispatched successfully.
3. **Given** a preflight check endpoint, **When** I call `POST /api/agents/{id}/jobs/bulk-preflight` with target groups, **Then** the response includes `accessible_groups` and `inaccessible_groups` lists.
4. **Given** the accessibility check runs during job creation, **When** the Telegram client fails to connect, **Then** the API returns 503 with a clear error about agent connectivity.

---

### User Story 4 — Stuck Job Recovery: Auto-Heal Hung Jobs (Priority: P1)

As a platform operator, I want the system to automatically detect and recover jobs that have been stuck in "running" status for too long, so that worker capacity is not permanently consumed by hung jobs.

**Why this priority**: Agents 6 and 11 have jobs stuck in "running" for 19+ hours. The current `reconcile_stale_jobs` only handles `PENDING` and `QUEUED` statuses, not `RUNNING`. Without recovery, these jobs consume worker capacity indefinitely until the 24-hour Dramatiq time limit kills them.

**Independent Test**: Can be tested by creating a job, setting its status to "running" with `updated_at` more than 2 hours ago, triggering the reconciliation endpoint, and verifying the job is reset to "pending" and re-dispatched.

**Acceptance Scenarios**:

1. **Given** a job with `status=running` and `updated_at` more than 2 hours ago, **When** `reconcile_stale_jobs` runs, **Then** the job's status is set to `pending` and it is re-dispatched.
2. **Given** a job with `status=running` and `updated_at` less than 2 hours ago, **When** `reconcile_stale_jobs` runs, **Then** the job is left untouched.
3. **Given** a stuck job that has been re-queued 3 times, **When** `reconcile_stale_jobs` runs again, **Then** the job is marked as `failed` with reason `max_retries_exceeded`.
4. **Given** the reconciliation runs on a schedule, **When** it executes, **Then** it logs each recovered job with `agent_id`, `job_id`, and `stuck_duration`.
5. **Given** a job with existing checkpoint progress, **When** it is recovered and re-dispatched, **Then** it resumes from the last checkpoint (not from scratch).

---

### User Story 5 — Auto-Dispatch on Scrape Completion (Priority: P2)

As an agent admin, I want broadcast jobs to be automatically created when a group finishes scraping (if I have a pre-configured broadcast template), so that I don't have to manually trigger broadcasts for each of my 121 groups.

**Why this priority**: Agent 15 has 121 groups and 741 members but zero jobs dispatched. The user must manually create a broadcast for each agent. Auto-dispatch eliminates this friction and ensures agents are utilized immediately after scraping.

**Independent Test**: Can be tested by configuring an auto-broadcast template for an agent, triggering a group scrape, and verifying that a broadcast job is automatically created and dispatched when the scrape completes.

**Acceptance Scenarios**:

1. **Given** an agent with `auto_broadcast_enabled=true` and a configured `auto_broadcast_template`, **When** a group scrape completes, **Then** a `group_member_broadcast` job is automatically created for the scraped group.
2. **Given** an agent with `auto_broadcast_enabled=false`, **When** a group scrape completes, **Then** no broadcast job is created.
3. **Given** an auto-broadcast job is created, **When** it executes, **Then** it uses the agent's `auto_broadcast_template` as the message content.
4. **Given** an auto-broadcast targets a group with 0 scraped members, **When** the scrape completes, **Then** no broadcast job is created (skip empty groups).
5. **Given** an agent at its daily message limit, **When** a scrape completes and would trigger auto-broadcast, **Then** the job is created with `status=scheduled` for the next available window.

---

### User Story 6 — Rate Limit Defaults: Prevent FloodWait Bans (Priority: P2)

As a platform operator, I want new agents to have sensible rate limit defaults instead of NULL values, so that the system proactively prevents Telegram FloodWait errors instead of relying on server-side enforcement.

**Why this priority**: All agents currently have NULL rate limits (`cooldown_minutes`, `max_actions_per_hour`, `max_messages_per_day`, `min_delay_seconds`). Without defaults, the only protection is Telegram's server-side FloodWait, which can ban an account for hours. Sensible defaults provide a safety net.

**Independent Test**: Can be tested by creating a new agent and verifying that `max_actions_per_hour=50`, `max_messages_per_day=200`, `min_delay_seconds=30`, and `cooldown_minutes=60` are set automatically.

**Acceptance Scenarios**:

1. **Given** a new agent is created, **When** no rate limits are specified, **Then** defaults are applied: `max_actions_per_hour=50`, `max_messages_per_day=200`, `min_delay_seconds=30`, `cooldown_minutes=60`.
2. **Given** a new agent is created with explicit rate limits, **When** the limits are provided in the request, **Then** the provided values are used (defaults do not override).
3. **Given** an existing agent with NULL rate limits, **When** a migration runs, **Then** defaults are backfilled for all existing agents.
4. **Given** an agent that hits its `max_messages_per_day` limit, **When** a new broadcast job starts, **Then** the job is scheduled for the next day instead of failing immediately.

---

### User Story 7 — Dashboard Job Health Monitoring (Priority: P3)

As an agent admin, I want a real-time job health panel in the dashboard showing running jobs, elapsed time, estimated completion, and stuck job indicators, so that I can proactively manage broadcast operations.

**Why this priority**: Currently there is no visibility into job execution progress. The user only sees "running" or "completed" status. Without progress indicators, stuck jobs go unnoticed for hours. This is important for operations but not a blocker for the core fixes.

**Independent Test**: Can be tested by starting a broadcast job, opening the dashboard, and verifying the job health panel shows: job ID, agent name, elapsed time, messages sent/total, estimated time remaining, and last checkpoint timestamp.

**Acceptance Scenarios**:

1. **Given** a running broadcast job, **When** I view the job health panel, **Then** I see: job ID, agent name, status, elapsed time, messages sent, total recipients, and estimated completion time.
2. **Given** a job that has been running for more than 2 hours without checkpoint updates, **When** I view the health panel, **Then** the job is highlighted with a "possibly stuck" warning indicator.
3. **Given** a stuck job, **When** I click "Recover" on the health panel, **Then** the job is reset to pending and re-dispatched.
4. **Given** multiple agents with active jobs, **When** I view the health panel, **Then** I can filter by agent and sort by elapsed time or status.
5. **Given** the health panel, **When** a job completes, **Then** the panel updates in real-time (via polling or WebSocket) to show the final result.

---

### Edge Cases

- What happens when a broadcast job is checkpointed, recovered, and the target group has been deleted? The job should detect the missing group and mark those recipients as failed with reason `group_deleted`.
- What happens when two workers pick up the same recovered job simultaneously? The per-agent lock in `SessionManager.get_client` serializes client acquisition, but the send loop itself is not locked — dedup via `SentBroadcastMessage` records prevents duplicate sends.
- What happens when the graduated interval strategy is active and a FloodWait error occurs mid-broadcast? The job should be re-queued with the FloodWait delay, and on resume, continue with the graduated interval from where it left off.
- What happens when auto-dispatch creates a job but the agent's session has been revoked? The job should fail immediately with `AgentSessionRevokedError` and notify the admin.
- What happens when rate limit defaults are backfilled via migration but an agent has custom limits set via the dashboard? The migration must only update NULL values, never overwrite existing limits.
- What happens when the dashboard health panel polls for updates and the backend is under heavy load? The polling interval should be configurable and default to 10 seconds to avoid overwhelming the API.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist broadcast progress (`sent_users`, `success_count`, `failure_count`, `last_checkpoint_at`) to `agent_jobs.job_payload` in the database during execution.
- **FR-002**: System MUST checkpoint progress after every 10 successful sends OR every 60 seconds, whichever comes first.
- **FR-003**: System MUST resume a broadcast job from its last checkpoint when re-executed, skipping recipients already in `sent_users`.
- **FR-004**: System MUST support a graduated interval strategy with configurable tiers: `[50 contacts @ 30s, 50 @ 60s, 100 @ 120s, 200 @ 180s, ∞ @ 300s]`.
- **FR-005**: System MUST use the graduated interval strategy by default when `interval_between_contacts` is not explicitly set in the job payload.
- **FR-006**: System MUST maintain backward compatibility — if `interval_between_contacts` is explicitly set, use the fixed interval.
- **FR-007**: System MUST validate group accessibility before dispatching a broadcast job, returning 422 if any target group is inaccessible.
- **FR-008**: System MUST expose group accessibility status in the `POST /api/agents/{id}/jobs/bulk-preflight` response.
- **FR-009**: System MUST extend `reconcile_stale_jobs` to detect `RUNNING` jobs with `updated_at` older than a configurable threshold (default: 2 hours).
- **FR-010**: System MUST re-queue stuck `RUNNING` jobs (set to `pending` and re-dispatch) up to a configurable max retry count (default: 3).
- **FR-011**: System MUST mark a job as `failed` with reason `max_retries_exceeded` after exceeding the stuck-job retry limit.
- **FR-012**: System MUST support `auto_broadcast_enabled` and `auto_broadcast_template` fields on the `Agent` model.
- **FR-013**: System MUST automatically create and dispatch a broadcast job when a group scrape completes, if the agent has `auto_broadcast_enabled=true`.
- **FR-014**: System MUST apply default rate limits on agent creation: `max_actions_per_hour=50`, `max_messages_per_day=200`, `min_delay_seconds=30`, `cooldown_minutes=60`.
- **FR-015**: System MUST provide a database migration that backfills NULL rate limits on existing agents without overwriting non-NULL values.
- **FR-016**: System MUST expose a job health endpoint (`GET /api/agents/{id}/jobs/health`) returning running jobs with progress metrics.
- **FR-017**: System MUST include `messages_sent`, `total_recipients`, `elapsed_seconds`, `estimated_completion_seconds`, and `last_checkpoint_at` in the health response.
- **FR-018**: System MUST flag jobs as `possibly_stuck` in the health response if `last_checkpoint_at` is more than 2 hours old.
- **FR-019**: System MUST provide a manual recovery action (`POST /api/agents/{id}/jobs/{job_id}/recover`) that resets a stuck job to pending and re-dispatches it.
- **FR-020**: Database migration MUST be backward compatible — all new columns must be nullable or have defaults.

### Key Entities

- **AgentJob.job_payload.progress**: New nested object within the existing JSONB `job_payload` column. Stores `sent_users` (list of tg_user_ids), `success_count`, `failure_count`, `last_checkpoint_at`, `retry_count`.
- **Agent.auto_broadcast_enabled**: Boolean flag (default: false) controlling whether auto-dispatch is active.
- **Agent.auto_broadcast_template**: Text field storing the message template for auto-dispatched broadcasts.
- **Agent.max_actions_per_hour / max_messages_per_day / min_delay_seconds / cooldown_minutes**: Existing nullable integer fields that will receive default values on creation and via migration.
- **JobHealthResponse**: New API response schema containing `running_jobs` (list), each with `job_id`, `agent_id`, `status`, `messages_sent`, `total_recipients`, `elapsed_seconds`, `estimated_completion_seconds`, `last_checkpoint_at`, `is_possibly_stuck`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A 500-contact broadcast completes in under 6 hours (vs 200+ hours currently) using the graduated interval strategy.
- **SC-002**: A broadcast job that is interrupted at 50% progress resumes from 50% on re-execution (verified by `sent_users` count in checkpoint).
- **SC-003**: Creating a broadcast job for an inaccessible group returns 422 within 5 seconds (no job dispatched).
- **SC-004**: A job stuck in "running" for more than 2 hours is automatically recovered within the next reconciliation cycle (≤5 minutes).
- **SC-005**: A new agent created via the API has non-NULL rate limit values without explicit specification.
- **SC-006**: When a group scrape completes for an agent with `auto_broadcast_enabled=true`, a broadcast job appears in the job queue within 30 seconds.
- **SC-007**: The job health endpoint returns all running jobs with accurate progress metrics within 2 seconds.
- **SC-008**: Zero duplicate messages are sent when a job is recovered and resumed from checkpoint (verified by `SentBroadcastMessage` dedup).

## Assumptions

- The existing `SentBroadcastMessage` table provides reliable deduplication — `tg_user_id + agent_id + message_hash` uniqueness prevents duplicate sends even without checkpoint-based dedup.
- The graduated interval thresholds (30s → 300s) are safe for Telegram's rate limits based on typical account standing. Accounts with prior restrictions may need custom thresholds.
- The `reconcile_stale_jobs` function is called periodically (via the scheduler loop or a dedicated CRON). If not, a new periodic trigger must be added.
- The Telegram client's `iter_participants` or `get_participants` call can be used to validate group accessibility without sending messages.
- The `auto_broadcast_template` supports the same variable substitution as manual broadcast messages (e.g., `{first_name}`, `{group_name}`).
- The dashboard frontend will be updated to display the new health endpoint data, but the API is the primary deliverable — frontend updates can follow in a separate spec.
- Existing broadcast jobs in the database with no `progress` field in `job_payload` will be treated as starting from scratch (backward compatible).
