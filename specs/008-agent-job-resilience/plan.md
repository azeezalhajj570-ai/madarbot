# Implementation Plan: Agent Job Resilience & Smart Dispatch

**Branch**: `008-agent-job-resilience` | **Date**: 2026-07-05 | **Spec**: `specs/008-agent-job-resilience/spec.md`

**Input**: Feature specification from `specs/008-agent-job-resilience/spec.md`

## Summary

Fix the root causes preventing 4 of 5 active agents from successfully sending broadcast messages. Implement progress checkpointing to survive job interruptions, graduated send intervals to complete broadcasts in hours instead of days, group accessibility validation to prevent silent failures, stuck job recovery to auto-heal hung jobs, auto-dispatch to eliminate idle agents, rate limit defaults to prevent FloodWait bans, and a job health monitoring API for operational visibility.

## Technical Context

**Language/Version**: Python 3.11

**Primary Dependencies**: FastAPI, SQLAlchemy 2.0, Alembic, Dramatiq, Telethon, Redis

**Storage**: PostgreSQL 16, Redis

**Testing**: pytest

**Target Platform**: Linux server (Docker)

**Project Type**: Web application (FastAPI backend + React SPA frontend + Dramatiq worker)

## Project Structure

### Documentation (this feature)

```
specs/008-agent-job-resilience/
├── spec.md                  # Feature spec
├── plan.md                  # This file
└── tasks.md                 # Implementation tasks
```

### Source Code

```
bot/
├── agents/
│   ├── runtime.py           # MOD: checkpoint progress in send loop, graduated intervals
│   ├── worker.py            # MOD: resume from checkpoint on job start
│   ├── dispatch.py          # MOD: extend reconcile_stale_jobs for RUNNING status
│   ├── agent_job_service.py # MOD: group accessibility validation in create_job
│   └── jobs.py              # MOD: graduated interval strategy in normalize payload
├── db/models/
│   └── agent.py             # MOD: add auto_broadcast_enabled, auto_broadcast_template
├── services/
│   └── scraper_service.py   # MOD: trigger auto-dispatch on scrape completion
├── dashboard/api/routers/
│   └── agents.py            # MOD: health endpoint, recover action, preflight enhancement
└── migrations/
    └── versions/            # NEW: migration for new columns + rate limit defaults
```

## Phases

### Phase 1 — Progress Checkpointing (P0, ~4 hours)

**Goal**: Persist broadcast progress to DB during execution so jobs can resume after interruption.

**Files to modify**:
- `bot/agents/runtime.py` — Add checkpoint logic in the send loop (after every 10 sends or 60s)
- `bot/agents/worker.py` — Load existing progress from `job_payload` on job start, skip already-sent recipients
- `bot/agents/jobs.py` — Add `progress` schema to `normalize_group_member_broadcast_payload`

**Key implementation**:
```python
# In runtime.py send loop, after each successful send:
if success_count % 10 == 0 or (time.time() - last_checkpoint) > 60:
    job.job_payload["progress"] = {
        "sent_users": list(sent_users),
        "success_count": success_count,
        "failure_count": failure_count,
        "last_checkpoint_at": datetime.utcnow().isoformat(),
    }
    await session.commit()
    last_checkpoint = time.time()
```

**Verification**: Start a broadcast, kill the worker, restart, verify job resumes from checkpoint.

---

### Phase 2 — Graduated Interval Strategy (P0, ~2 hours)

**Goal**: Replace fixed 25-40 minute intervals with graduated delays to complete broadcasts 50x faster.

**Files to modify**:
- `bot/agents/runtime.py` — Replace fixed `effective_interval` with graduated lookup
- `bot/agents/jobs.py` — Add `GRADUATED_INTERVAL_TIERS` constant and strategy selection in payload normalization

**Key implementation**:
```python
GRADUATED_INTERVAL_TIERS = [
    (50, 30),    # First 50 contacts: 30s
    (100, 60),   # Contacts 51-100: 60s
    (200, 120),  # Contacts 101-200: 120s
    (400, 180),  # Contacts 201-400: 180s
    (float('inf'), 300),  # 401+: 300s (5 min)
]

def get_interval_for_contact(index: int, strategy: str, custom_interval: float | None) -> float:
    if strategy == "fixed" and custom_interval:
        return custom_interval
    for threshold, interval in GRADUATED_INTERVAL_TIERS:
        if index < threshold:
            return interval
    return 300
```

**Verification**: Run a 100-contact broadcast, verify first 50 use ~30s delays, next 50 use ~60s.

---

### Phase 3 — Group Accessibility Validation (P1, ~2 hours)

**Goal**: Validate agent can access target groups before dispatching, return 422 on inaccessible groups.

**Files to modify**:
- `bot/agents/agent_job_service.py` — Add accessibility check in `create_job()` before dispatch
- `bot/dashboard/api/routers/agents.py` — Enhance `bulk-preflight` endpoint with accessibility status
- `bot/agents/session.py` — Add `check_group_accessibility(agent_id, group_ids)` method

**Key implementation**:
```python
async def check_group_accessibility(client: TelegramClient, group_ids: list[int]) -> dict:
    accessible = []
    inaccessible = []
    dialogs = await client.get_dialogs()
    dialog_ids = {d.id for d in dialogs}
    for gid in group_ids:
        if gid in dialog_ids:
            accessible.append(gid)
        else:
            inaccessible.append(gid)
    return {"accessible": accessible, "inaccessible": inaccessible}
```

**Verification**: Create a broadcast for a group the agent hasn't joined, verify 422 response.

---

### Phase 4 — Stuck Job Recovery (P1, ~2 hours)

**Goal**: Extend `reconcile_stale_jobs` to detect and recover `RUNNING` jobs stuck for >2 hours.

**Files to modify**:
- `bot/agents/dispatch.py` — Extend `reconcile_stale_jobs` to include `RUNNING` status with age check
- `bot/agents/worker.py` — Add `retry_count` tracking in job_payload, fail after max retries
- `bot/config.py` — Add `STUCK_JOB_THRESHOLD_HOURS` and `STUCK_JOB_MAX_RETRIES` settings

**Key implementation**:
```python
async def reconcile_stale_jobs(session: AsyncSession) -> int:
    threshold = datetime.utcnow() - timedelta(hours=settings.STUCK_JOB_THRESHOLD_HOURS)
    
    # Existing: PENDING/QUEUED jobs
    stale_pending = await session.execute(
        select(AgentJob).where(
            AgentJob.status.in_([JOB_STATUS_PENDING, JOB_STATUS_QUEUED]),
            AgentJob.updated_at < threshold
        )
    )
    
    # New: RUNNING jobs stuck for too long
    stale_running = await session.execute(
        select(AgentJob).where(
            AgentJob.status == JOB_STATUS_RUNNING,
            AgentJob.updated_at < threshold
        )
    )
    
    recovered = 0
    for job in stale_running.scalars():
        retry_count = job.job_payload.get("progress", {}).get("retry_count", 0)
        if retry_count >= settings.STUCK_JOB_MAX_RETRIES:
            job.status = JOB_STATUS_FAILED
            job.job_payload["failure_reason"] = "max_retries_exceeded"
        else:
            job.status = JOB_STATUS_PENDING
            job.job_payload.setdefault("progress", {})["retry_count"] = retry_count + 1
            await dispatch_agent_job(job.id)
            recovered += 1
    
    await session.commit()
    return recovered
```

**Verification**: Set a job to `running` with old `updated_at`, trigger reconcile, verify it's re-queued.

---

### Phase 5 — Auto-Dispatch on Scrape Completion (P2, ~3 hours)

**Goal**: Automatically create broadcast jobs when a group finishes scraping, if the agent has auto-broadcast enabled.

**Files to modify**:
- `bot/db/models/agent.py` — Add `auto_broadcast_enabled` (Boolean, default=False) and `auto_broadcast_template` (Text, nullable)
- `bot/services/scraper_service.py` — Add post-scrape hook to trigger auto-dispatch
- `bot/agents/agent_job_service.py` — Add `create_auto_broadcast_job(agent_id, group_id)` method
- Alembic migration for new columns

**Key implementation**:
```python
async def on_scrape_completed(agent_id: int, group_id: int, session: AsyncSession):
    agent = await session.get(Agent, agent_id)
    if not agent or not agent.auto_broadcast_enabled or not agent.auto_broadcast_template:
        return
    
    member_count = await session.scalar(
        select(func.count()).select_from(ScrapedMember).where(
            ScrapedMember.group_id == group_id
        )
    )
    if not member_count or member_count == 0:
        return
    
    job = await AgentJobService.create_job(
        agent_id=agent_id,
        job_type=GROUP_MEMBER_BROADCAST_JOB_TYPE,
        payload={
            "group_ids": [group_id],
            "message_template": agent.auto_broadcast_template,
            "target_type": "members",
        },
        session=session,
    )
    await dispatch_agent_job(job.id)
```

**Verification**: Enable auto-broadcast for an agent, trigger a scrape, verify a broadcast job is created.

---

### Phase 6 — Rate Limit Defaults (P2, ~1 hour)

**Goal**: Apply sensible rate limit defaults on agent creation and backfill existing NULL values via migration.

**Files to modify**:
- `bot/db/models/agent.py` — Add server defaults or `default=` on rate limit columns
- `bot/services/agent_service.py` (or wherever agents are created) — Set defaults if not provided
- Alembic migration to backfill NULL values

**Key implementation**:
```python
# Migration: backfill NULL rate limits
def upgrade():
    op.execute("""
        UPDATE agents SET
            max_actions_per_hour = COALESCE(max_actions_per_hour, 50),
            max_messages_per_day = COALESCE(max_messages_per_day, 200),
            min_delay_seconds = COALESCE(min_delay_seconds, 30),
            cooldown_minutes = COALESCE(cooldown_minutes, 60)
    """)
```

**Verification**: Create a new agent without specifying rate limits, verify defaults are applied. Run migration, verify existing agents with NULL values are updated.

---

### Phase 7 — Dashboard Job Health Monitoring (P3, ~3 hours)

**Goal**: Expose a job health API and recovery action for operational visibility.

**Files to modify**:
- `bot/dashboard/api/routers/agents.py` — Add `GET /api/agents/{id}/jobs/health` and `POST /api/agents/{id}/jobs/{job_id}/recover`
- `bot/agents/agent_job_service.py` — Add `get_job_health(agent_id)` and `recover_job(agent_id, job_id)` methods
- `bot/dashboard/api/routers/_shared.py` — Add `JobHealthResponse` Pydantic schema

**Key implementation**:
```python
@router.get("/api/agents/{agent_id}/jobs/health")
async def get_job_health(agent_id: int, session: AsyncSession = Depends(get_session)):
    running_jobs = await session.execute(
        select(AgentJob).where(
            AgentJob.agent_id == agent_id,
            AgentJob.status == JOB_STATUS_RUNNING
        )
    )
    
    health_data = []
    for job in running_jobs.scalars():
        progress = job.job_payload.get("progress", {})
        elapsed = (datetime.utcnow() - job.updated_at).total_seconds()
        sent = progress.get("success_count", 0)
        total = job.job_payload.get("total_recipients", 0)
        last_checkpoint = progress.get("last_checkpoint_at")
        
        health_data.append({
            "job_id": job.id,
            "agent_id": agent_id,
            "status": job.status,
            "messages_sent": sent,
            "total_recipients": total,
            "elapsed_seconds": elapsed,
            "estimated_completion_seconds": (total - sent) * 60 if sent > 0 else None,
            "last_checkpoint_at": last_checkpoint,
            "is_possibly_stuck": (
                last_checkpoint is not None and
                (datetime.utcnow() - datetime.fromisoformat(last_checkpoint)).total_seconds() > 7200
            ),
        })
    
    return {"running_jobs": health_data}
```

**Verification**: Start a broadcast, call the health endpoint, verify progress metrics are accurate.

---

## Migration Strategy

All changes are backward compatible:

1. **New columns** (`auto_broadcast_enabled`, `auto_broadcast_template`) are nullable or have defaults
2. **Rate limit backfill** only updates NULL values, never overwrites existing limits
3. **Progress checkpointing** adds a new `progress` key to the existing `job_payload` JSONB — old jobs without it are treated as starting from scratch
4. **Graduated intervals** only activate when `interval_between_contacts` is not explicitly set — existing jobs with fixed intervals are unaffected
5. **Stuck job recovery** is additive — the existing `reconcile_stale_jobs` behavior for PENDING/QUEUED is unchanged

## Rollback Plan

Each phase is independent and can be rolled back individually:

- **Phase 1-2**: Revert code changes; existing jobs continue to work (no schema changes)
- **Phase 3**: Revert code changes; accessibility check is skipped
- **Phase 4**: Revert code changes; stuck jobs remain stuck until manual intervention
- **Phase 5**: Revert code changes + drop new columns via migration
- **Phase 6**: Revert code changes; rate limits remain at their current values
- **Phase 7**: Revert code changes; health endpoint returns 404

## Testing Strategy

- **Unit tests**: Test graduated interval calculation, checkpoint serialization, accessibility check logic
- **Integration tests**: Test full broadcast lifecycle with checkpoint/resume, stuck job recovery, auto-dispatch
- **Manual verification**: Run broadcasts against test Telegram groups, verify timing and message delivery
- **Load testing**: Verify checkpoint writes don't significantly impact broadcast throughput
