# Tasks: Agent Job Resilience & Smart Dispatch

**Input**: Design documents from `specs/008-agent-job-resilience/`

**Prerequisites**: plan.md, spec.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US7)

---

## Phase 1: Progress Checkpointing (US1 — P0)

**Purpose**: Persist broadcast progress to DB so jobs survive interruptions and resume from last checkpoint.

- [ ] T001 [US1] Add `progress` schema to `normalize_group_member_broadcast_payload()` in `bot/agents/jobs.py`:
  - `sent_users: list[int]` (default: `[]`)
  - `success_count: int` (default: `0`)
  - `failure_count: int` (default: `0`)
  - `last_checkpoint_at: str | None` (default: `None`)
  - `retry_count: int` (default: `0`)
- [ ] T002 [US1] Modify `GroupMemberBroadcastRuntime.execute()` in `bot/agents/runtime.py`:
  - Load existing `progress` from `job_payload` at start
  - Initialize `sent_users` set from checkpoint
  - Skip recipients already in `sent_users`
- [ ] T003 [US1] Add checkpoint write logic in the send loop (`runtime.py`):
  - After every 10 successful sends OR every 60 seconds
  - Write `sent_users`, `success_count`, `failure_count`, `last_checkpoint_at` to `job.job_payload["progress"]`
  - Call `await session.commit()`
- [ ] T004 [US1] Add final checkpoint write on job completion (success or failure path)
- [ ] T005 [US1] Modify `_execute_agent_job_impl()` in `bot/agents/worker.py`:
  - On job start, check for existing `progress` in `job_payload`
  - If found, log `"agent_job_resuming_from_checkpoint"` with `sent_count` and `remaining_count`
  - Pass checkpoint data to runtime

**Checkpoint**: Broadcast progress persists to DB. Killed jobs resume from checkpoint on restart.

---

## Phase 2: Graduated Interval Strategy (US2 — P0)

**Purpose**: Replace fixed 25-40 min intervals with graduated delays for 50x faster completion.

- [ ] T006 [P] [US2] Add `GRADUATED_INTERVAL_TIERS` constant and `get_interval_for_contact()` function in `bot/agents/jobs.py`:
  ```python
  GRADUATED_INTERVAL_TIERS = [
      (50, 30), (100, 60), (200, 120), (400, 180), (float("inf"), 300)
  ]
  ```
- [ ] T007 [US2] Add `interval_strategy` field to broadcast payload normalization:
  - `"graduated"` (default when `interval_between_contacts` is not set)
  - `"fixed"` (when `interval_between_contacts` is explicitly set)
- [ ] T008 [US2] Modify `GroupMemberBroadcastRuntime.execute()` in `bot/agents/runtime.py`:
  - Replace fixed `effective_interval` with `get_interval_for_contact(index, strategy, custom_interval)`
  - Apply ±10% jitter to all intervals
- [ ] T009 [US2] Verify backward compatibility: jobs with explicit `interval_between_contacts` still use fixed interval

**Checkpoint**: 100-contact broadcast completes in ~90 minutes (vs 42 hours with fixed 1500s).

---

## Phase 3: Group Accessibility Validation (US3 — P1)

**Purpose**: Prevent silent "success with 0 sends" by validating group access before dispatch.

- [ ] T010 [P] [US3] Add `check_group_accessibility()` method to `SessionManager` in `bot/agents/session.py`:
  - Takes `agent_id` and `group_ids`
  - Uses Telegram client to verify agent has joined each group
  - Returns `{"accessible": [...], "inaccessible": [...]}`
- [ ] T011 [US3] Add accessibility check in `AgentJobService.create_job()` (`bot/agents/agent_job_service.py`):
  - Call `check_group_accessibility()` before dispatching
  - Raise `JobValidationError` with inaccessible group names if any
- [ ] T012 [US3] Enhance `POST /api/agents/{id}/jobs/bulk-preflight` in `bot/dashboard/api/routers/agents.py`:
  - Add `accessible_groups` and `inaccessible_groups` to response
  - Add `accessibility_warnings` list with human-readable messages
- [ ] T013 [US3] Add `JobValidationError` exception class in `bot/agents/exceptions.py`
- [ ] T014 [US3] Handle `JobValidationError` in API router — return 422 with structured error detail

**Checkpoint**: Creating a broadcast for an inaccessible group returns 422 with clear error message.

---

## Phase 4: Stuck Job Recovery (US4 — P1)

**Purpose**: Auto-detect and recover jobs stuck in "running" status for >2 hours.

- [ ] T015 [P] [US4] Add settings to `bot/config.py`:
  - `STUCK_JOB_THRESHOLD_HOURS: int = 2`
  - `STUCK_JOB_MAX_RETRIES: int = 3`
- [ ] T016 [US4] Extend `reconcile_stale_jobs()` in `bot/agents/dispatch.py`:
  - Add query for `RUNNING` jobs with `updated_at < threshold`
  - For each stuck job: check `retry_count` in `job_payload.progress`
  - If `retry_count < max_retries`: set status to `pending`, increment retry_count, re-dispatch
  - If `retry_count >= max_retries`: set status to `failed` with reason `max_retries_exceeded`
  - Log each recovery with `agent_id`, `job_id`, `stuck_duration`
- [ ] T017 [US4] Ensure `reconcile_stale_jobs` is called periodically:
  - Check if scheduler loop already triggers it
  - If not, add a dedicated periodic task (every 5 minutes)
- [ ] T018 [US4] Update `updated_at` timestamp in the send loop during checkpoint writes (so active jobs don't appear stuck)

**Checkpoint**: Job stuck in "running" for >2 hours is automatically re-queued within 5 minutes.

---

## Phase 5: Auto-Dispatch on Scrape Completion (US5 — P2)

**Purpose**: Automatically create broadcast jobs when scraping completes for agents with auto-broadcast enabled.

- [ ] T019 [P] [US5] Add columns to `Agent` model in `bot/db/models/agent.py`:
  - `auto_broadcast_enabled: Mapped[bool]` (default: `False`)
  - `auto_broadcast_template: Mapped[str | None]` (nullable)
- [ ] T020 [US5] Generate Alembic migration for new columns
- [ ] T021 [US5] Add `create_auto_broadcast_job()` method to `AgentJobService` in `bot/agents/agent_job_service.py`:
  - Takes `agent_id` and `group_id`
  - Creates a `group_member_broadcast` job using the agent's template
  - Skips if group has 0 scraped members
- [ ] T022 [US5] Add post-scrape hook in scraper completion flow (`bot/services/scrapers/` or `bot/agents/worker.py`):
  - After scrape completes, check if agent has `auto_broadcast_enabled`
  - If yes, call `create_auto_broadcast_job()`
  - Dispatch the job immediately (or schedule if agent is at daily limit)
- [ ] T023 [US5] Add `auto_broadcast_enabled` and `auto_broadcast_template` to agent update API endpoint
- [ ] T024 [US5] Add auto-broadcast configuration UI to agent settings in frontend (optional, can be API-only initially)

**Checkpoint**: Scrape completion for an auto-broadcast-enabled agent creates and dispatches a broadcast job.

---

## Phase 6: Rate Limit Defaults (US6 — P2)

**Purpose**: Apply sensible rate limit defaults on agent creation and backfill existing NULL values.

- [ ] T025 [P] [US6] Add default values to rate limit columns in `Agent` model (`bot/db/models/agent.py`):
  - `max_actions_per_hour: default=50`
  - `max_messages_per_day: default=200`
  - `min_delay_seconds: default=30`
  - `cooldown_minutes: default=60`
- [ ] T026 [US6] Generate Alembic migration to backfill NULL rate limits on existing agents:
  ```sql
  UPDATE agents SET max_actions_per_hour = 50 WHERE max_actions_per_hour IS NULL;
  UPDATE agents SET max_messages_per_day = 200 WHERE max_messages_per_day IS NULL;
  UPDATE agents SET min_delay_seconds = 30 WHERE min_delay_seconds IS NULL;
  UPDATE agents SET cooldown_minutes = 60 WHERE cooldown_minutes IS NULL;
  ```
- [ ] T027 [US6] Verify agent creation API applies defaults when rate limits are not specified
- [ ] T028 [US6] Verify migration does not overwrite existing non-NULL values

**Checkpoint**: New agents have non-NULL rate limits. Existing agents with NULL values are backfilled.

---

## Phase 7: Dashboard Job Health Monitoring (US7 — P3)

**Purpose**: Expose job health API and recovery action for operational visibility.

- [ ] T029 [P] [US7] Add `JobHealthResponse` schema to `bot/dashboard/api/routers/_shared.py`:
  ```python
  class JobHealthItem(BaseModel):
      job_id: int
      agent_id: int
      status: str
      messages_sent: int
      total_recipients: int
      elapsed_seconds: float
      estimated_completion_seconds: float | None
      last_checkpoint_at: str | None
      is_possibly_stuck: bool

  class JobHealthResponse(BaseModel):
      running_jobs: list[JobHealthItem]
  ```
- [ ] T030 [US7] Add `get_job_health()` method to `AgentJobService` in `bot/agents/agent_job_service.py`
- [ ] T031 [US7] Add `GET /api/agents/{agent_id}/jobs/health` endpoint in `bot/dashboard/api/routers/agents.py`
- [ ] T032 [US7] Add `recover_job()` method to `AgentJobService`:
  - Validates job is in `running` status
  - Resets to `pending`, increments retry_count
  - Re-dispatches via `dispatch_agent_job()`
- [ ] T033 [US7] Add `POST /api/agents/{agent_id}/jobs/{job_id}/recover` endpoint
- [ ] T034 [US7] Add job health panel to frontend dashboard (optional, can be API-only initially)

**Checkpoint**: Health endpoint returns accurate progress metrics for running jobs. Recovery action re-queues stuck jobs.

---

## Phase 8: Tests & Verification

**Purpose**: Verify all acceptance criteria and backward compatibility.

- [ ] T035 [US1] Test: checkpoint is written after 10 sends
- [ ] T036 [US1] Test: checkpoint is written after 60 seconds (even with <10 sends)
- [ ] T037 [US1] Test: job resumes from checkpoint, skipping already-sent recipients
- [ ] T038 [US1] Test: job without checkpoint starts from scratch (backward compatible)
- [ ] T039 [US2] Test: graduated intervals are applied correctly for 100 contacts
- [ ] T040 [US2] Test: fixed interval is used when explicitly set (backward compatible)
- [ ] T041 [US3] Test: broadcast for inaccessible group returns 422
- [ ] T042 [US3] Test: broadcast for accessible groups succeeds
- [ ] T043 [US3] Test: preflight endpoint returns accessibility status
- [ ] T044 [US4] Test: stuck job (>2h running) is recovered
- [ ] T045 [US4] Test: job with max retries exceeded is marked failed
- [ ] T046 [US4] Test: active job (recent checkpoint) is not flagged as stuck
- [ ] T047 [US5] Test: auto-broadcast job created on scrape completion
- [ ] T048 [US5] Test: no auto-broadcast when disabled
- [ ] T049 [US5] Test: no auto-broadcast for empty group
- [ ] T050 [US6] Test: new agent has default rate limits
- [ ] T051 [US6] Test: explicit rate limits are not overridden by defaults
- [ ] T052 [US6] Test: migration backfills NULL values only
- [ ] T053 [US7] Test: health endpoint returns running jobs with progress
- [ ] T054 [US7] Test: recovery action re-queues stuck job
- [ ] T055 [US7] Test: possibly_stuck flag is set correctly

**Checkpoint**: All acceptance criteria verified. No regressions in existing broadcast flow.

---

## Phase Dependencies

- **Phase 1** (Checkpointing): No dependencies — can start immediately
- **Phase 2** (Intervals): No dependencies — can start in parallel with Phase 1
- **Phase 3** (Accessibility): No dependencies — can start in parallel with Phase 1-2
- **Phase 4** (Recovery): Depends on Phase 1 (checkpoint data needed for retry_count tracking)
- **Phase 5** (Auto-dispatch): Depends on Phase 3 (accessibility check should run before auto-dispatch)
- **Phase 6** (Rate Limits): No dependencies — can start in parallel with any phase
- **Phase 7** (Health): Depends on Phase 1 (reads checkpoint data for progress metrics)
- **Phase 8** (Tests): Depends on all prior phases

### Parallel Execution Opportunities

```
Phase 1 (Checkpointing) ──┐
Phase 2 (Intervals)    ──┤── can run in parallel
Phase 3 (Accessibility)──┤
Phase 6 (Rate Limits)  ──┘
         │
         ▼
Phase 4 (Recovery)     ── depends on Phase 1
Phase 7 (Health)       ── depends on Phase 1
         │
         ▼
Phase 5 (Auto-dispatch)── depends on Phase 3
         │
         ▼
Phase 8 (Tests)        ── depends on all
```
