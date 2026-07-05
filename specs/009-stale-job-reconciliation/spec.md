# Feature Specification: Periodic Stale Job Reconciliation

**Feature Branch**: `009-stale-job-reconciliation`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description: "Run reconcile_stale_jobs() automatically every 30 minutes so stuck broadcasts recover without manual API calls"

## User Scenarios & Testing

### User Story 1 - Automatic Stuck Job Recovery (Priority: P1)

As an agent operator, I want stuck broadcast jobs to be automatically detected and recovered so that I don't need to manually call the reconcile API every time a job hangs.

**Why this priority**: This is the core feature — without it, stuck jobs remain stuck until someone remembers to call the API. This completes the resilience loop that was started in spec 008.

**Independent Test**: Can be verified by checking the backend logs for `reconcile_cycle_complete` messages at expected intervals, and by observing that a job with `status=running` and `updated_at > 2h` is automatically re-queued.

**Acceptance Scenarios**:

1. **Given** a running job has been stuck for more than 2 hours with no checkpoint updates, **When** the reconcile loop runs, **Then** the job is reset to `pending` status and re-dispatched
2. **Given** the reconcile loop is enabled, **When** it runs on schedule, **Then** a log entry is produced with the counts of reconciled/recovered/failed jobs
3. **Given** a job has exceeded the max retry count (default 3), **When** the reconcile loop runs, **Then** the job is marked as `failed` with reason `max_retries_exceeded`

### Edge Cases

- What happens when the database is unreachable during a reconcile tick? → Error is logged, loop continues at next interval
- What happens when the reconcile loop runs while a previous tick is still executing? → Each tick is sequential (no concurrent ticks), `asyncio.sleep` ensures spacing
- What happens when `scheduler_enabled` is false but `reconcile_enabled` is true? → Reconcile loop runs independently of the scheduler loop

## Requirements

### Functional Requirements

- **FR-001**: System MUST automatically call `reconcile_stale_jobs()` on a configurable periodic interval
- **FR-002**: The periodic reconcile MUST be controllable via `RECONCILE_ENABLED` environment variable (default: true)
- **FR-003**: The interval MUST be configurable via `RECONCILE_POLL_INTERVAL` environment variable (default: 1800 seconds = 30 minutes)
- **FR-004**: The reconcile loop MUST log its results (reconciled, recovered, failed counts) on each cycle
- **FR-005**: The reconcile loop MUST NOT block the scheduler loop or other background tasks
- **FR-006**: On application shutdown, the reconcile loop MUST be cancelled gracefully
- **FR-007**: The reconcile loop MUST NOT interfere with existing job state — it uses the same `reconcile_stale_jobs()` function that the manual API calls

### Key Entities

- **Settings**: New env vars `RECONCILE_ENABLED` and `RECONCILE_POLL_INTERVAL` in `bot/config.py`
- **Reconcile Loop**: New `reconcile_loop()` coroutine in `bot/services/scheduler.py`
- **FastAPI Lifespan**: New `reconcile_task` in `bot/dashboard/api/main.py` alongside existing `scheduler_task`

## Success Criteria

### Measurable Outcomes

- **SC-001**: A broadcast job stuck in `running` status for >2 hours is automatically re-dispatched within 30 minutes of the reconcile loop being enabled
- **SC-002**: The operator can disable the automatic reconcile by setting `RECONCILE_ENABLED=false` without restarting (on next deployment)
- **SC-003**: All existing agent broadcast infrastructure continues to work unchanged

## Assumptions

- The `reconcile_stale_jobs()` function in `bot/agents/dispatch.py` already handles all the business logic correctly (determining which jobs are stale, re-queuing vs failing)
- The FastAPI `backend` service is the correct place to run the reconcile loop (same as the existing scheduler loop)
- The reconcile loop does not need to run in the `agent_worker` or `bot` services — only the `backend` API service
- The reconcile loop's default 30-minute interval is appropriate for detecting stuck jobs (stuck threshold is 2 hours, so 30-minute checks are frequent enough)
