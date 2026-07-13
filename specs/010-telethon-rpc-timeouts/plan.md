# Implementation Plan: Telethon RPC Timeouts, Retries & Instrumentation

**Branch**: `010-telethon-rpc-timeouts` | **Date**: 2026-07-05 | **Spec**: [spec.md](./spec.md)

## Summary

Create a shared `call_with_retry()` wrapper for all Telethon RPCs that adds configurable timeout, exponential backoff retry, and automatic timing instrumentation. Add a `get_me()` health check before expensive broadcast operations. Replace all bare `get_entity()` and `iter_participants()` calls in `runtime.py` and session files with the wrapper. Leave `send_message()` unchanged initially.

## Technical Context

**Language/Version**: Python 3.11

**Primary Dependencies**: Telethon, asyncio, structlog, time

**Storage**: None (pure logic + logging)

**Testing**: pytest (unit tests for wrapper, integration tests for runtime)

**Target Platform**: Linux server (Docker)

**Constraints**: Must not add new dependencies; must not change send_message() behavior; must preserve existing error handling (FloodWait, banned agent detection)

## Architecture

### New Module: `bot/agents/rpc_wrapper.py`

```
rpc_wrapper.py
├── Constants (DEFAULT_TIMEOUT, HEALTH_CHECK_TIMEOUT, etc.)
├── call_with_retry(client, rpc_factory, rpc_name, ...)
│   └── Logs: rpc_completed / rpc_timed_out / rpc_failed
├── iter_participants_with_timeout(client, entity, timeout, ...)
│   └── Async generator, wraps each __anext__ with timeout
│   └── Logs: iter_participants_completed / iter_participants_batch_timed_out
└── check_agent_health(client)
    └── Calls get_me() with 10s timeout
    └── Logs: agent_health_check_passed / agent_health_check_failed
```

### Call Pattern

```python
# Before (bare call):
entity = await client.get_entity(group_id)

# After (wrapped):
entity = await call_with_retry(
    client,
    lambda: client.get_entity(group_id),
    rpc_name="get_entity",
    timeout=20,
)
```

```python
# Before:
async for participant in client.iter_participants(group_entity):
    ...

# After:
async for participant in iter_participants_with_timeout(client, group_entity):
    ...
```

```python
# Before broadcast:
# (nothing)

# After broadcast:
await check_agent_health(client)
```

## Files Modified

| File | Change |
|------|--------|
| `bot/agents/rpc_wrapper.py` | **NEW** — shared wrapper module |
| `bot/agents/runtime.py` | Replace `get_entity()` → `call_with_retry()`; replace `iter_participants` → `iter_participants_with_timeout()`; add health check |
| `bot/agents/session.py` | Replace `get_entity()` in `check_group_accessibility()` |
| Various | (Future: other files that call `get_entity` / `iter_participants` bare) |

## Testing Strategy

- Unit test `call_with_retry()` with mocked coroutines:
  - Success on first attempt
  - Timeout then retry succeeds
  - All retries exhausted
  - Non-timeout error (not retried)
  - Fast call (< 500ms) does not log
- Unit test `iter_participants_with_timeout()` with mocked async iterator:
  - Normal iteration completes
  - Batch timeout raises properly
- Unit test `check_agent_health()`:
  - Healthy agent returns
  - Unhealthy agent raises

## Project Structure

```
bot/agents/
├── rpc_wrapper.py          # NEW — shared Telethon RPC wrapper
├── runtime.py              # MODIFIED — use wrappers
├── session.py              # MODIFIED — use wrapper for get_entity
├── (other files unchanged)

specs/010-telethon-rpc-timeouts/
├── spec.md
├── plan.md
└── tasks.md
```
