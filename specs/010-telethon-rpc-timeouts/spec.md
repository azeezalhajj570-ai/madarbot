# Feature Specification: Telethon RPC Timeouts, Retries & Instrumentation

**Feature Branch**: `010-telethon-rpc-timeouts`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description — "Add a shared timeout/retry wrapper for Telethon RPCs. Add get_me() as a health check. Add RPC timing instrumentation. Wrap get_entity() with the shared wrapper. Implement timeout handling for iter_participants(). Leave send_message() unchanged initially."

## User Scenarios & Testing

### User Story 1 - No More Hanging RPCs (Priority: P1)

As an agent operator, I want all Telethon RPCs to have bounded execution time so that a stalled network call does not block a job indefinitely.

**Why this priority**: This is blocking job 24 right now — `get_entity()` hung for 10+ minutes with no timeout, preventing any broadcast progress. Adding timeouts to `get_entity` and `iter_participants` is the minimal fix.

**Independent Test**: Can be verified by:
- Mocking a slow network and confirming `asyncio.TimeoutError` is raised after the configured timeout
- Checking logs for `rpc_completed` / `rpc_timed_out` entries with elapsed timing

**Acceptance Scenarios**:

1. **Given** an agent job calls `get_entity()` on an inaccessible group, **When** the timeout expires, **Then** a `TimeoutError` is raised and logged with `<rpc_name>_timed_out`
2. **Given** a `get_entity()` call succeeds, **When** it completes, **Then** a log entry is produced with `rpc_completed` and the elapsed duration
3. **Given** a `get_entity()` call times out, **When** retries are configured, **Then** the wrapper retries up to `max_retries` times with exponential backoff
4. **Given** a health check (`get_me()`) fails at the start of a broadcast, **When** the timeout expires, **Then** the job is failed early instead of hanging on member discovery

### User Story 2 - `iter_participants` With Partial Progress (Priority: P2)

As an agent operator, I want `iter_participants` to have a per-batch timeout so that a stalled participant fetch recovers rather than blocking the entire job.

**Why this priority**: Currently `iter_participants` can hang indefinitely on large groups (2091 members for job 24). A per-batch timeout allows recovery.

**Independent Test**: Run a broadcast on a group where participant fetching stalls mid-way; verify that the timeout fires and the job continues or errors cleanly.

**Acceptance Scenarios**:

1. **Given** `iter_participants` is iterating a group, **When** a batch fetch exceeds the timeout, **Then** the iteration raises `TimeoutError` with elapsed time logged
2. **Given** `iter_participants` completes successfully, **When** all participants are collected, **Then** a log entry shows total participant count and elapsed time

### Edge Cases

- What happens when all retries are exhausted? → The exception propagates to the caller (job marked as failed)
- What happens when `get_me()` fails during the health check? → The wrapper raises, the job fails with a clear error message
- What happens when `iter_participants` returns partial results before timeout? → The entire iteration fails atomically; partial results are not used to avoid sending to a subset
- What happens when the timeout is set to 0? → Treated as "no timeout" (pass-through to original RPC)
- What happens during a flood wait? → Flood wait errors are caught by existing handlers, not by the new wrapper

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide a shared `call_with_retry()` async function that wraps any Telethon RPC with timeout, retry with exponential backoff, and timing instrumentation
- **FR-002**: The wrapper MUST accept configurable `timeout` (default 20s), `max_retries` (default 2), `retry_delay` (default 1s), and `backoff` (default 2.0) parameters
- **FR-003**: The wrapper MUST log `rpc_completed` with elapsed time for calls taking > 500ms, and `rpc_timed_out` / `rpc_failed` for failures
- **FR-004**: The wrapper MUST raise the last exception when retries are exhausted
- **FR-005**: System MUST provide `iter_participants_with_timeout()` async generator that wraps each `__anext__` call with a timeout
- **FR-006**: The `iter_participants` wrapper MUST log total elapsed time and participant count on completion
- **FR-007**: System MUST add a `check_agent_health()` function that calls `client.get_me()` with a 10s timeout before expensive operations
- **FR-008**: System MUST replace all bare `client.get_entity()` calls in `runtime.py` with the shared wrapper
- **FR-009**: System MUST replace the bare `client.iter_participants()` call in `GroupMemberBroadcastRuntime` with `iter_participants_with_timeout()`
- **FR-010**: The existing `send_message()` timeout (60s) MUST remain unchanged

### Non-Functional Requirements

- **NFR-001**: Zero additional dependencies (stdlib only: `asyncio`, `time`, `structlog`)
- **NFR-002**: The wrapper must not introduce measurable overhead on successful fast calls (< 1ms overhead)
- **NFR-003**: All timing instrumentation must use `time.monotonic()` for accuracy

### Key Entities

- **`bot/agents/rpc_wrapper.py`**: New module containing `call_with_retry()`, `iter_participants_with_timeout()`, and `check_agent_health()`
- **`bot/agents/runtime.py`**: Modified — replace `get_entity()` with `call_with_retry()`, replace `iter_participants` with `iter_participants_with_timeout()`, add health check at broadcast start
- **`bot/agents/session.py`**: Modified — replace `get_entity()` in `check_group_accessibility()` with `call_with_retry()`
- **`bot/agents/group_membership.py`**: Modified — replace `get_entity()` calls with `call_with_retry()`
- **`bot/agents/account_group_membership_service.py`**: Modified — replace `iter_participants()` calls with `iter_participants_with_timeout()`

### Configuration

No new environment variables. Timeout values are hardcoded as module-level constants (tunable later if needed):

| Constant | Value | Location |
|----------|-------|----------|
| `DEFAULT_TIMEOUT` | 20 | `rpc_wrapper.py` |
| `HEALTH_CHECK_TIMEOUT` | 10 | `rpc_wrapper.py` |
| `ITER_PARTICIPANTS_TIMEOUT` | 30 | `rpc_wrapper.py` |
| `SEND_MESSAGE_TIMEOUT` | 60 | `runtime.py` (unchanged) |
| `DEFAULT_MAX_RETRIES` | 2 | `rpc_wrapper.py` |
| `DEFAULT_RETRY_DELAY` | 1.0 | `rpc_wrapper.py` |
| `DEFAULT_BACKOFF` | 2.0 | `rpc_wrapper.py` |
