# Implementation Plan: Periodic Stale Job Reconciliation

**Branch**: `009-stale-job-reconciliation` | **Date**: 2026-07-05 | **Spec**: [spec.md](./spec.md)

## Summary

Add a periodic background loop to call `reconcile_stale_jobs()` automatically, so stuck broadcast jobs recover without manual API calls. Follows the exact same pattern as the existing `scheduler_loop` — a `while True` async loop with `asyncio.sleep` between ticks, managed via the FastAPI lifespan.

## Technical Context

**Language/Version**: Python 3.11

**Primary Dependencies**: FastAPI, asyncio, structlog

**Storage**: PostgreSQL (via existing `reconcile_stale_jobs()` function)

**Testing**: pytest

**Target Platform**: Linux server (Docker)

**Constraints**: Must not block existing scheduler loop; must cancel cleanly on shutdown

## Project Structure

```
bot/
├── config.py              # + RECONCILE_ENABLED, RECONCILE_POLL_INTERVAL
├── services/
│   └── scheduler.py        # + reconcile_loop() coroutine
└── dashboard/api/
    └── main.py             # + reconcile_task in lifespan

specs/009-stale-job-reconciliation/
├── spec.md
├── plan.md
└── tasks.md
```

## Implementation Steps

### Step 1: Add config settings in `bot/config.py`

Add two new fields alongside existing `scheduler_enabled` / `scheduler_poll_interval`:

| Env var | Default | Description |
|---------|---------|-------------|
| `RECONCILE_ENABLED` | `true` | Enable periodic reconcile loop |
| `RECONCILE_POLL_INTERVAL` | `1800` | Seconds between reconcile ticks (30 min) |

### Step 2: Add `reconcile_loop()` in `bot/services/scheduler.py`

New coroutine following the same pattern as `scheduler_loop()`:

- `while True`: `try: await reconcile_stale_jobs()` → log results → `except Exception: log error` → `await asyncio.sleep(interval)`
- Log results when any jobs were reconciled/recovered/failed

### Step 3: Wire into FastAPI lifespan in `bot/dashboard/api/main.py`

Add `reconcile_task` alongside existing `scheduler_task`:

- Create `asyncio.create_task(reconcile_loop())` after scheduler task creation
- Cancel on shutdown in the same `yield` cleanup block
