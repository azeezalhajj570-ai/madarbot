# Spec: Recurring Tasks Support for Scheduled Messages to Groups

## Objective

Allow users to configure recurring schedules so the system automatically sends predefined messages to selected groups on a recurring basis (daily, weekly, monthly, or custom cron). Supports start/end dates, pause/resume, execution history, and a unified scheduling UI.

**User:** Bot owners who manage Telegram groups and send recurring announcements, reports, reminders, or marketing messages.

**Success:** Users can create, manage, and monitor recurring message schedules from the dashboard. Messages are reliably dispatched per schedule with no duplicates.

## Assumptions

1. We will build on the existing **`Campaign` model** and `AgentJob` system — recurring tasks are an extension of the campaign concept, not a new standalone table.
2. The **`scheduler_loop()`** in `bot/services/scheduler.py` will be extended to also poll for recurring campaign schedules (it currently only polls `AgentJob`).
3. The existing **`Campaign`** table (with `status`, `scheduled_at`, `message_template`, `target_filters`) will gain recurrence fields (`repeat_type`, `interval_value`, `end_type`, `end_value`, `next_run_at`, `last_run_at`, `run_count`, `max_runs`, `timezone`).
4. Frontend changes go in **`apps/miniapp-agents/`** (React SPA), not the old dashboard.
5. MCP tools will be added for managing recurring tasks.
6. We use **PostgreSQL** for persistence, **Dramatiq** for async job dispatch, **Telethon** for message sending.
→ Correct any of these before I proceed.

## Tech Stack

- **Backend:** Python 3.11+, FastAPI, SQLAlchemy 2.0 async, Dramatiq (existing stack)
- **Frontend:** React 18, TypeScript, existing API client in `packages/miniapp-shared/`
- **Database:** PostgreSQL 16 (via asyncpg)
- **Worker:** Dramatiq (existing `agent_worker`)
- **Scheduler:** asyncio-based polling loop (extension of existing `scheduler.py`)
- **Telegram Client:** Telethon (via existing `GroupMemberBroadcastRuntime`)

## Commands

```
Build backend:   docker compose build bot
Build frontend:  docker compose build miniapp_agents
Dev backend:     docker compose up -d backend
Dev frontend:    docker compose up -d miniapp_agents
Test backend:    docker compose run --rm bot pytest
Lint:            ruff check bot/
Type check:      pyright bot/
```

## Project Structure (additions/changes)

```
bot/
├── db/
│   └── models/
│       ├── campaign.py          # + recurrence fields (repeat_type, interval, end_type, end_value, next_run_at, last_run_at, run_count, max_runs, timezone)
│       └── campaign_recurrence_log.py  # NEW: execution history per-trigger
├── services/
│   ├── scheduler.py             # + recurring campaign polling
│   └── campaign_service.py      # + recurrence CRUD, scheduling logic
├── dashboard/
│   └── api/
│       └── routers/
│           ├── campaigns.py     # + pause/resume, edit recurring, execution history
│           └── admin_automation.py  # may need endpoint updates
├── workers/
│   └── tasks.py                 # + run_recurring_campaign actor
├── mcp/
│   └── tools/
│       └── campaigns.py         # NEW or extend existing for recurring task management
apps/miniapp-agents/
├── src/
│   ├── pages/
│   │   ├── CampaignsPage.tsx    # + recurring schedule UI
│   │   └── RecurringScheduleForm.tsx  # NEW: reusable schedule form component
│   └── components/
│       └── SchedulePicker.tsx   # NEW: frequency/time/end-repeat picker
packages/miniapp-shared/
└── src/
    └── api/
        └── types.ts             # + RecurringSchedule, RecurringCampaign types
```

## Code Style

Follow existing project conventions:
- **Python:** Async/await patterns, SQLAlchemy 2.0 `select()` style, no comments on obvious code
- **TypeScript:** Strict TS, named exports, React functional components with hooks
- **API:** Pydantic v2 for request/response models, FastAPI dependency injection

## Data Model

### Campaign table — new fields

| Field | Type | Description |
|-------|------|-------------|
| `recurrence_enabled` | Boolean | Whether this campaign repeats |
| `repeat_type` | Enum or String | `daily`, `weekly`, `monthly`, `cron` |
| `interval_value` | Integer | Every N days/weeks/months (1 for cron) |
| `repeat_time` | Time | Time of day to send (e.g. 20:00) |
| `cron_expression` | String or null | Custom 5-field cron (when repeat_type=cron) |
| `end_type` | Enum or String | `never`, `on_date`, `after_n_runs` |
| `end_value` | String or null | Date string or integer count |
| `timezone` | String | e.g. `Asia/Aden`, `UTC` |
| `next_run_at` | DateTime or null | Computed next trigger time |
| `last_run_at` | DateTime or null | Last trigger time |
| `run_count` | Integer | Number of times triggered |
| `max_runs` | Integer or null | Max triggers (when end_type=after_n_runs) |

### New: campaign_recurrence_logs table

| Field | Type | Description |
|-------|------|-------------|
| `id` | PK | Auto-increment |
| `campaign_id` | FK → campaigns | Parent campaign |
| `triggered_at` | DateTime | When this run was triggered |
| `job_id` | FK → agent_jobs | The created job for this run |
| `status` | String | `pending`, `sending`, `sent`, `failed` |
| `error` | Text | Error message if failed |

## API Endpoints (additions to existing campaign routes)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webapp/agents/{agent_id}/campaigns` | + recurrence fields in body |
| GET | `/webapp/agents/{agent_id}/campaigns` | + recurrence fields in response |
| PATCH | `/webapp/agents/{agent_id}/campaigns/{id}` | Edit all fields including recurrence |
| POST | `/webapp/agents/{agent_id}/campaigns/{id}/pause` | Pause recurring schedule |
| POST | `/webapp/agents/{agent_id}/campaigns/{id}/resume` | Resume recurring schedule |
| POST | `/webapp/agents/{agent_id}/campaigns/{id}/run-now` | Trigger immediate run |
| GET | `/webapp/agents/{agent_id}/campaigns/{id}/recurrence-logs` | Execution history |

## Scheduler Behavior

The existing `scheduler_loop()` in `bot/services/scheduler.py` will be extended to:

1. Every `scheduler_poll_interval` seconds, query campaigns where:
   - `recurrence_enabled = true`
   - `status` = `active`
   - `next_run_at <= now()`
2. For each due campaign:
   - Create an `AgentJob` with this campaign's message_template and target groups
   - Transition job to `pending` for dispatch
   - Log to `campaign_recurrence_logs`
   - Compute `next_run_at` based on schedule config
   - Increment `run_count`
   - If `run_count >= max_runs` or `end_date` passed → set status to `completed`
3. Lock campaign row to prevent duplicate processing (`SELECT ... FOR UPDATE`)

## Testing Strategy

| Level | What | Where |
|-------|------|-------|
| Unit | `ScheduledMessageService` cron parsing, `next_run_at` computation | `tests/test_scheduled_message_service.py` |
| Unit | Campaign recurrence CRUD (db model, service methods) | `tests/test_campaign_service.py` |
| Integration | Scheduler loop picks up due recurring campaigns | `tests/test_scheduler.py` |
| Frontend | React component rendering, form validation | `apps/miniapp-agents/src/__tests__/` |

## Boundaries

- **Always:** Validate recurrence config (timezone exists, cron expression valid, end_date after start_date, max_runs > 0)
- **Ask first:** Adding new Python dependencies, schema migrations that affect existing data, changing the Dramatiq worker configuration
- **Never:** Remove existing scheduled message functionality (`announcement_schedules`), change the existing `AgentJob` scheduling mechanism without migration plan, send duplicate messages due to race conditions

## Success Criteria

1. Users can create a campaign with daily/weekly/monthly/custom cron recurrence in the UI
2. The scheduler picks up due campaigns and dispatches messages reliably
3. Users can pause, resume, edit, and view execution history of recurring campaigns
4. No duplicate messages are sent during scheduler restarts or retries
5. Campaign auto-completes when max runs reached or end date passed
6. Existing one-shot campaigns continue to work unchanged

## Resolved Decisions

1. **Target mode:** Groups mode only (send to entire groups). Members mode deferred.
2. **UI placement:** Integrated into the existing Campaigns form — recurrence fields appear when "Recurring" toggle is checked, with sensible defaults.
3. **Run Now:** Include a "Run Now" button on the campaign detail/recurring log view.
4. **Timezones:** Full IANA tz DB support via standard `pytz`/`zoneinfo`.

## UX Behavior

- By default, the "Send once" option is selected (existing behavior unchanged)
- When user selects "Recurring", new fields slide in:
  - Repeat (default: Daily)
  - Frequency interval (default: 1)
  - Time (default: current time rounded to 30min)
  - Start date (default: today)
  - End repeat — Never (default)
- All existing campaign functionality remains untouched

## References

- Issue: #152
- Existing campaign model: `bot/db/models/campaign.py`
- Existing scheduler: `bot/services/scheduler.py`
- Existing campaign service: `bot/services/campaign_service.py`
- Existing campaign API: `bot/dashboard/api/routers/campaigns.py`
- Existing frontend: `apps/miniapp-agents/src/pages/CampaignsPage.tsx`
