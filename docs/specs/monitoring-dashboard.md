# Spec Kit: System Administration Monitoring Dashboard

## Status: Draft

---

## 1. Motivation

As a system administrator or product owner, there is no single place to assess the health of all MadarBot services at a glance. Currently:

- Health endpoints exist (`/health`, `/api/internal/health`) but are isolated
- Prometheus metrics are defined in `bot/monitoring/metrics.py` but never exposed via HTTP
- Job status is tracked per-agent, with no cross-agent aggregated view
- Container healthchecks exist only for Postgres and Redis (not for app containers)
- Error tracking via Sentry is only configured in the bot worker, not in the backend FastAPI app
- There is no alerting mechanism when services go down or jobs pile up

This spec covers a comprehensive monitoring layer for the backend FastAPI app, infrastructure improvements, a standalone monitoring UI, and a health-alert notification system.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      FastAPI (backend)                           │
│                                                                  │
│  GET /metrics              ← prometheus_client (always served)   │
│  GET /api/internal/health  ← basic health (exists)               │
│  GET /api/internal/system-health ← DB, Redis, workers, queue     │
│  GET /webapp/owner/stats   ← extended with job breakdown         │
│  GET /dashboard/monitor    ← standalone HTML monitoring page     │
│                                                                  │
│  Sentry SDK init on startup                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        docker-compose.yml                        │
│                                                                  │
│  bot:          healthcheck: curl -f http://bot:8080/health       │
│  agent_worker: healthcheck: ping via Redis presence              │
│  backend:      healthcheck: curl -f http://localhost:8000/health │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  bot/monitoring/health_alerts.py                  │
│                                                                  │
│  Cron-like loop (runs inside backend container):                 │
│  1. Hit /api/internal/system-health                              │
│  2. If any service unhealthy → send Telegram alert to owners     │
│  3. If pending jobs > threshold → send Telegram alert            │
└─────────────────────────────────────────────────────────────────┘
```

### Key files

| File | Role |
|---|---|
| `bot/dashboard/api/main.py` | Mount `/metrics` endpoint, init Sentry, serve `/dashboard/monitor` |
| `bot/dashboard/api/routers/internal.py` | New `GET /api/internal/system-health` endpoint |
| `bot/dashboard/api/owner.py` | Extend `/webapp/owner/stats` with job breakdown |
| `bot/dashboard/api/routers/monitoring.py` | New router for monitoring page + health UI data |
| `bot/monitoring/metrics.py` | Already exists; Prometheus metrics (unchanged) |
| `bot/monitoring/health_alerts.py` | New: periodic health check + Telegram alert |
| `bot/dashboard/frontend/monitor.html` | New: standalone monitoring HTML page |
| `docker-compose.yml` | Add healthchecks for bot, agent_worker, backend |

---

## 3. API Changes

### 3.1 `GET /metrics` — Prometheus metrics endpoint

**Purpose:** Expose `prometheus_client` metrics for scraping by Prometheus / Grafana.

**Implementation:** Add to `bot/dashboard/api/main.py`:

```python
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

@app.get("/metrics")
async def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
```

**Metrics exposed** (from `bot/monitoring/metrics.py`):

| Metric | Type | Labels | Description |
|---|---|---|---|
| `madarbot_messages_total` | Counter | `chat_type` | Total incoming messages |
| `madarbot_moderation_actions_total` | Counter | `action` | Moderation actions by type |
| `madarbot_handler_duration_seconds` | Histogram | `handler` | Handler latency |

**Rate limiting:** Exempted from rate limiter (alongside `/health` and `/favicon.ico`).

---

### 3.2 `GET /api/internal/system-health` — aggregated system health

**Purpose:** Return status of all services in one call. Used by the monitoring UI and the alerting script.

**Response schema (200):**

```json
{
  "status": "degraded",
  "checks": {
    "database": {
      "status": "ok",
      "latency_ms": 2.3
    },
    "redis": {
      "status": "ok",
      "latency_ms": 0.8
    },
    "bot_worker": {
      "status": "ok",
      "last_seen": "2026-07-06T10:00:00+00:00",
      "uptime_seconds": 86400
    },
    "agent_worker": {
      "status": "unknown",
      "detail": "presence key not found in Redis"
    },
    "queue": {
      "status": "ok",
      "pending": 5,
      "running": 2,
      "total": 7
    },
    "recent_failures_24h": {
      "count": 3,
      "jobs": [
        {"id": 101, "agent_id": 1, "job_type": "group_member_broadcast", "updated_at": "..."}
      ]
    }
  },
  "timestamp": "2026-07-06T10:30:00+00:00"
}
```

**Overall `status`** is derived from individual checks:
- `"ok"` — all checks pass
- `"degraded"` — at least one non-critical check fails (queue has failures, but services alive)
- `"down"` — database or redis unreachable

**Implementation details:**

| Check | How it's probed |
|---|---|
| `database` | `SELECT 1` via `engine.execution_options(...)` with a 3s timeout |
| `redis` | `await redis.ping()` with a 3s timeout |
| `bot_worker` | Look for Redis key `bot:worker:last_seen` — if fresh (<60s) → ok |
| `agent_worker` | Look for Redis key `agent:worker:last_seen` — if fresh (<60s) → ok |
| `queue` | Count `AgentJob` rows by status; count failed in last 24h |
| `recent_failures_24h` | Query `AgentJob` where `status = "failed"` and `updated_at > now - 24h` |

**Auth:** Requires bot-owner identity (same as other internal endpoints).

---

### 3.3 Extended `GET /webapp/owner/stats`

**Current response:**

```json
{
  "total_groups": 10,
  "active_groups": 8,
  "tracked_admins": 45,
  "moderation_actions": 1200,
  "open_warnings": 15,
  "enabled_plugins": 22,
  "linked_agents": 12,
  "pending_agent_jobs": 3
}
```

**New fields appended:**

```json
{
  "...existing fields...": "...",
  "jobs_by_status": {
    "pending": 2,
    "queued": 1,
    "running": 3,
    "completed": 150,
    "failed": 5,
    "aborted": 1
  },
  "total_jobs": 162,
  "stuck_jobs": 1,
  "failure_rate_24h": 0.03,
  "messages_sent_24h": 450,
  "active_agents": 10
}
```

| Field | Source |
|---|---|
| `jobs_by_status` | `GROUP BY status ON AgentJob` |
| `stuck_jobs` | Jobs running for > `stuck_job_threshold_hours` (config: 2h) |
| `failure_rate_24h` | `failed / (failed + completed)` in last 24h |
| `messages_sent_24h` | Count `SentBroadcastMessage` where `sent_at > now - 24h` |
| `active_agents` | `Agent` where `status = "active"` |

---

## 4. Sentry for Backend

**File:** `bot/dashboard/api/main.py`

Add near the top of the file, before `app = FastAPI(...)`:

```python
import sentry_sdk

settings = get_settings()
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        traces_sample_rate=0.1,
        environment="production",
    )
    logger.info("sentry_initialized for dashboard API")
```

The `SENTRY_DSN` config variable already exists in `Settings`. The bot worker already has Sentry; this adds it to the FastAPI backend as well.

---

## 5. Infrastructure: Docker Container Healthchecks

**File:** `docker-compose.yml`

### bot service
```yaml
healthcheck:
  test: ["CMD", "python", "-c", "import http.client; c=http.client.HTTPConnection('localhost', 8080); c.request('GET', '/health'); r=c.getresponse(); exit(0) if r.status == 200 else exit(1)"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 30s
```

### agent_worker service
```yaml
healthcheck:
  test: ["CMD-SHELL", "pgrep -f 'dramatiq bot.agents.worker' || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 30s
```

### backend service
```yaml
healthcheck:
  test: ["CMD", "python", "-c", "import http.client; c=http.client.HTTPConnection('localhost', 8080); c.request('GET', '/health'); r=c.getresponse(); exit(0) if r.status == 200 else exit(1)"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 30s
```

---

## 6. Monitoring UI: Standalone HTML Page

**Route:** `GET /dashboard/monitor`

**File:** `bot/dashboard/frontend/monitor.html`

A self-contained HTML page (no build step needed) that:

1. Fetches `GET /api/internal/system-health` every 15 seconds
2. Fetches `GET /webapp/owner/stats` every 30 seconds
3. Renders:
   - **Header**: overall status badge (green/amber/red) + timestamp
   - **Service cards**: DB, Redis, bot worker, agent worker — each with status icon, latency, last seen
   - **Queue panel**: bar chart or table of jobs by status, total count, stuck count
   - **Recent failures table**: ID, agent, type, time
   - **Stats row**: Groups, agents, messages sent 24h, moderation actions

**Auth:** Requires browser dashboard auth (same as `/dashboard`) or bot-owner identity.

**Implementation:** The page uses vanilla JS + CSS (no framework) for zero build overhead. Style matches the existing browser SPA (dark theme, green accent).

**Wireframe:**

```
┌─────────────────────────────────────────────────────────────┐
│  ● System Status: OK                  Last updated: 10:30   │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│ Database  │  Redis   │ Bot      │ Agent    │ Queue           │
│ ● OK      │ ● OK     │ ● OK     │ ● OK     │ Pending: 5      │
│ 2.3ms     │ 0.8ms    │ 10s ago  │ 30s ago  │ Running: 2      │
│           │          │          │          │ Failed/24h: 3   │
├──────────┴──────────┴──────────┴──────────┴─────────────────┤
│ Jobs by Status                                               │
│ pending [##] 2   queued [#] 1   running [###] 3             │
│ completed [████████████████] 150  failed [##] 5              │
│                                                              │
│ Stuck Jobs: 1  │  Failure Rate (24h): 3%                    │
├─────────────────────────────────────────────────────────────┤
│ Recent Failures (24h)                                        │
│ ┌──────┬────────┬──────────────────────┬────────────┐       │
│ │ ID   │ Agent  │ Type                 │ Time       │       │
│ ├──────┼────────┼──────────────────────┼────────────┤       │
│ │ 101  │ #1     │ group_member_broadcast│ 09:45     │       │
│ │ 102  │ #3     │ scrape_members       │ 08:30     │       │
│ └──────┴────────┴──────────────────────┴────────────┘       │
├─────────────────────────────────────────────────────────────┤
│ Stats Summary                                                │
│ Groups: 10   Active: 8   Agents: 12   Msgs/24h: 450        │
│ Mod Actions: 1200   Warnings: 15  Plugins: 22               │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Health Alert Script

**File:** `bot/monitoring/health_alerts.py`

**Purpose:** Runs inside the backend container (via a background task or scheduled cron) and sends Telegram alerts when services are unhealthy.

**Algorithm:**

```
loop every 300 seconds:
  1. GET /api/internal/system-health (localhost)
  2. If overall status is "down":
     - Send Telegram message to all bot_owner_ids:
       "🚨 SYSTEM DOWN: DB/Redis unreachable"
  3. If any check is not "ok":
     - Send Telegram message listing degraded services
  4. If pending jobs > threshold (default 50):
     - Send alert: "⚠️ Queue backlog: {n} pending jobs"
  5. If recent failures > threshold (default 10):
     - Send alert: "⚠️ {n} job failures in last 24h"
  6. Cooldown: Don't re-alert for the same issue within 30 minutes
```

**Implementation:**

```python
# bot/monitoring/health_alerts.py
import asyncio
import logging
from datetime import datetime, timedelta

import httpx
from aiogram import Bot

from bot.config import get_settings

logger = logging.getLogger(__name__)

class HealthAlertService:
    def __init__(self):
        self._last_alerts: dict[str, datetime] = {}
        self._cooldown = timedelta(minutes=30)

    async def check_and_alert(self):
        settings = get_settings()
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.get("http://localhost:8000/api/internal/system-health")
                data = resp.json()
            except Exception as e:
                await self._alert_owners(settings, f"🚨 Cannot reach system-health endpoint: {e}")
                return

        overall = data.get("status", "unknown")
        checks = data.get("checks", {})

        if overall == "down":
            await self._alert_owners(settings, f"🚨 SYSTEM DOWN – Database or Redis unreachable")

        degraded = [name for name, chk in checks.items() if chk.get("status") not in ("ok", None)]
        if degraded:
            details = "; ".join(f"{n}: {checks[n].get('status')}" for n in degraded)
            await self._alert_owners(settings, f"⚠️ Degraded services: {details}")

        queue = checks.get("queue", {})
        if queue.get("pending", 0) > 50:
            await self._alert_owners(settings, f"⚠️ Queue backlog: {queue['pending']} pending jobs")

        failures = checks.get("recent_failures_24h", {})
        if failures.get("count", 0) > 10:
            await self._alert_owners(settings, f"⚠️ {failures['count']} job failures in last 24h")

    async def _alert_owners(self, settings, message: str):
        if self._is_throttled(message):
            return
        self._last_alerts[message] = datetime.utcnow()
        bot = Bot(token=settings.bot_token)
        try:
            for owner_id in settings.bot_owner_ids:
                await bot.send_message(owner_id, message)
        finally:
            await bot.session.close()

    def _is_throttled(self, key: str) -> bool:
        last = self._last_alerts.get(key)
        if last and datetime.utcnow() - last < self._cooldown:
            return True
        return False
```

**Integration:** Start the alert loop in the FastAPI lifespan alongside the scheduler:

```python
# In lifespan() in main.py
alert_task = None
if settings.sentry_dsn:  # or a dedicated ENABLE_HEALTH_ALERTS setting
    from bot.monitoring.health_alerts import HealthAlertService
    alert_service = HealthAlertService()
    async def alert_loop():
        while True:
            await asyncio.sleep(300)
            try:
                await alert_service.check_and_alert()
            except Exception:
                logger.exception("health_alert_check_failed")
    alert_task = asyncio.create_task(alert_loop())
```

---

## 8. File Changes

### New files

| File | Lines | Purpose |
|---|---|---|
| `bot/dashboard/frontend/monitor.html` | ~300 | Standalone monitoring UI page |
| `bot/monitoring/health_alerts.py` | ~80 | Health check + Telegram alert loop |

### Modified files

| File | Change |
|---|---|
| `bot/dashboard/api/main.py` | +15 lines: import prometheus_client, add `/metrics`, init Sentry, add alert loop to lifespan, serve `/dashboard/monitor` |
| `bot/dashboard/api/routers/internal.py` | +80 lines: new `system-health` endpoint |
| `bot/dashboard/api/owner.py` | +15 lines: extend `stats()` return with job breakdown |
| `docker-compose.yml` | +30 lines: healthchecks for bot, agent_worker, backend |

### No changes needed

- `bot/monitoring/metrics.py` — already defined, just needs to be served
- `bot/config.py` — `SENTRY_DSN` already exists
- No DB schema changes — all queries use existing tables

---

## 9. Acceptance Criteria

1. `GET /metrics` returns Prometheus-formatted metrics with `Content-Type: text/plain; version=0.0.4`
2. `GET /api/internal/system-health` returns a JSON response with all service checks
3. `system-health` correctly identifies when DB, Redis, workers are down
4. `GET /webapp/owner/stats` includes `jobs_by_status`, `stuck_jobs`, `failure_rate_24h`, `messages_sent_24h`, `active_agents`
5. Docker healthchecks pass for all 3 app containers (`docker compose ps` shows `healthy`)
6. `GET /dashboard/monitor` renders a functional monitoring page that polls health data
7. Health alert script sends Telegram message when a service goes down
8. Alert throttling prevents duplicate alerts within 30 minutes
9. Sentry captures errors in the backend (test by triggering a 500 error)
10. All existing tests still pass
11. Rate limiter does not block `/metrics`
