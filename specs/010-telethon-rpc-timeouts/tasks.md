# Tasks: Telethon RPC Timeouts, Retries & Instrumentation

**Input**: Design documents from `specs/010-telethon-rpc-timeouts/`

## Phase 1: Shared Wrapper Module

**Purpose**: Create `bot/agents/rpc_wrapper.py` with timeout/retry/instrumentation helpers

- [ ] T001 Create `bot/agents/rpc_wrapper.py` with constants and `call_with_retry()` function
      - `call_with_retry()`: wraps any coroutine with `asyncio.wait_for`, retries on timeout with exponential backoff, logs timing
      - Log `rpc_completed` at info level for calls > 500ms elapsed
      - Log `rpc_timed_out` at warning level with attempt number
      - Log `rpc_failed` at warning level for non-timeout errors
      - Raise last exception when retries exhausted

- [ ] T002 Add `check_agent_health()` function to `rpc_wrapper.py`
      - Calls `client.get_me()` with 10s timeout via `call_with_retry`
      - Returns `True` on success
      - Raises on failure

- [ ] T003 Add `iter_participants_with_timeout()` async generator to `rpc_wrapper.py`
      - Wraps each `client.iter_participants().__anext__()` with `asyncio.wait_for` (30s timeout)
      - On timeout: logs `iter_participants_batch_timed_out` with yielded count, then raises `TimeoutError`
      - On success: logs `iter_participants_completed` with total count and elapsed time

## Phase 2: Integrate Into runtime.py

**Purpose**: Replace bare Telethon calls with wrapped versions in the broadcast path

- [ ] T004 Add health check (`check_agent_health()`) at the start of `GroupMemberBroadcastRuntime.execute()`
      - Call before any entity resolution or member iteration
      - If health check fails, the exception propagates and job fails fast

- [ ] T005 Replace `AddContactRuntime.resolve_group_entity()` bare `get_entity()` calls with `call_with_retry()`
      - Lines 119, 133, 142, 151 in current runtime.py
      - Timeout: 20s, max_retries: 2

- [ ] T006 Replace `client.iter_participants()` in broadcast loop (line 353) with `iter_participants_with_timeout()`
      - Use 30s per-batch timeout via the new wrapper

- [ ] T007 Replace `client.iter_participants()` in `AddContactRuntime.execute()` (line 225) with `iter_participants_with_timeout()`

- [ ] T008 Replace `client.get_entity()` in `AddContactRuntime.execute()` (line 244) with `call_with_retry()`

## Phase 3: Integrate Into session.py

**Purpose**: Replace bare `get_entity()` in session management

- [ ] T009 Replace `client.get_entity()` in `session.py:check_group_accessibility()` with `call_with_retry()`

## Phase 4: Verification

**Purpose**: Confirm the feature works end-to-end

- [ ] T010 Verify syntax: `python -m py_compile bot/agents/rpc_wrapper.py bot/agents/runtime.py bot/agents/session.py`
- [ ] T011 Run existing tests: `python -m pytest tests/ -x -q --tb=short -k "broadcast or rpc or agent" 2>&1 | tail -20`
- [ ] T012 Deploy and observe `rpc_completed` / `rpc_timed_out` / `iter_participants_completed` logs in agent_worker container
- [ ] T013 Verify job 24 no longer hangs — confirm it either fails fast (if group inaccessible) or proceeds with timeout-recovered sends
- [ ] T014 Verify job 25 continues making progress with `send_message` timeout unchanged

## Phase 5: Follow-Up (Only If Metrics Show Benefit)

**Purpose**: Adjust timeouts based on collected metrics

- [ ] T015 Review `rpc_completed` elapsed times to determine optimal timeout values
- [ ] T016 Consider reducing `send_message` timeout from 60s to 20s if metrics support it
- [ ] T017 Audit remaining bare Telethon RPCs across codebase (scraper_service, entity_resolver, etc.) for future coverage
