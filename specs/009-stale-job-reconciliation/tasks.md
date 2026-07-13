# Tasks: Periodic Stale Job Reconciliation

**Input**: Design documents from `specs/009-stale-job-reconciliation/`

## Phase 1: Implementation

**Purpose**: Add periodic reconcile loop alongside existing scheduler

- [ ] T001 Add `reconcile_enabled` (default true) and `reconcile_poll_interval` (default 1800) to `bot/config.py`
- [ ] T002 Add `reconcile_loop()` coroutine in `bot/services/scheduler.py` that calls `reconcile_stale_jobs()` on interval
- [ ] T003 Wire `reconcile_task` into FastAPI lifespan in `bot/dashboard/api/main.py` (create + cancel on shutdown)

---

## Phase 2: Verification

**Purpose**: Confirm the feature works end-to-end

- [ ] T004 Verify syntax: `python -m py_compile bot/config.py bot/services/scheduler.py bot/dashboard/api/main.py`
- [ ] T005 Deploy and observe `reconcile_cycle_complete` logs in backend container
