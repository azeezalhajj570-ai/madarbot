# Task List: Recurring Tasks Support

## Phase 1: Database & API Foundation

- [ ] **Task 1: DB migration — add recurrence columns + new table**
  - **Acceptance:** Migration `add_campaign_recurrence` adds columns to `campaigns` and creates `campaign_recurrence_logs` table. Rollback works cleanly.
  - **Verify:** `alembic upgrade head` succeeds; `alembic downgrade -1` succeeds.
  - **Files:** `alembic/versions/`, `bot/db/models/__init__.py`

- [ ] **Task 2: Update Campaign model and service layer**
  - **Acceptance:** Campaign model has all recurrence fields; `_to_dict()` includes them; `create_campaign` and `update_campaign` accept recurrence params; existing tests pass.
  - **Verify:** Backend builds (`ruff check`), no type errors.
  - **Files:** `bot/db/models/campaign.py`, `bot/services/campaign_service.py`

- [ ] **Task 3: Update campaign API endpoints**
  - **Acceptance:** Create/update/list/get campaign endpoints accept and return recurrence fields. New `pause` and `resume` endpoints work. Run-now endpoint triggers immediate launch.
  - **Verify:** `curl` requests to endpoints work as expected.
  - **Files:** `bot/dashboard/api/routers/campaigns.py`

### Checkpoint: Phase 1
- [ ] Alembic migration applies cleanly
- [ ] Backend starts without errors
- [ ] Campaign CRUD round-trips recurrence fields

## Phase 2: Scheduler & Execution

- [ ] **Task 4: Extend scheduler loop for recurring campaigns**
  - **Acceptance:** `scheduler_loop()` polls campaigns where `recurrence_enabled=true`, `status='active'`, `next_run_at <= now()`. For each due campaign, creates + dispatches `AgentJob` per target group. Updates `next_run_at`, `run_count`, `last_run_at`. Logs to `campaign_recurrence_logs`. Uses `SELECT ... FOR UPDATE` to prevent duplicate dispatch.
  - **Verify:** Unit test with mock session shows correct query + job creation.
  - **Files:** `bot/services/scheduler.py`, `bot/services/campaign_service.py` (new `process_recurring_campaigns` method)

- [ ] **Task 5: Campaign pause/resume/run-now + status transitions**
  - **Acceptance:** `pause` sets campaign status to `paused` (scheduler skips it). `resume` sets back to `active` and recomputes `next_run_at`. `run-now` triggers immediate launch without affecting schedule.
  - **Verify:** API calls result in correct DB state changes.
  - **Files:** `bot/dashboard/api/routers/campaigns.py`, `bot/services/campaign_service.py`

### Checkpoint: Phase 2
- [ ] Recurring campaign triggers on schedule
- [ ] Pause/resume stops/resumes
- [ ] Run-now fires immediately
- [ ] No duplicate jobs during scheduler restart

## Phase 3: Frontend

- [ ] **Task 6: Update TypeScript Campaign type + API client**
  - **Acceptance:** `Campaign` interface has all recurrence fields. API functions for pause, resume, run-now, recurrence logs exist.
  - **Verify:** TypeScript compiles without errors.
  - **Files:** `packages/miniapp-shared/src/types/index.ts`, `packages/miniapp-shared/src/api/agents.ts`

- [ ] **Task 7: Build SchedulePicker component**
  - **Acceptance:** Reusable component renders the frequency UI: Repeat selector (None/Daily/Weekly/Monthly/Custom), Frequency interval, Time picker, Start date, End repeat (Never/On date/After N runs). Shows next run preview. All fields have sensible defaults.
  - **Verify:** Storybook or inline test renders component.
  - **Files:** `apps/miniapp-agents/src/components/SchedulePicker.tsx`

- [ ] **Task 8: Integrate recurrence into CampaignsPage**
  - **Acceptance:** When creating a campaign, user sees "Send once" / "Recurring" toggle. When "Recurring" is selected, SchedulePicker appears. On save, campaign is created with recurrence config. Campaign list shows recurrence badge. Campaign detail shows pause/resume/run-now buttons and execution history.
  - **Verify:** Full UI flow works end-to-end.
  - **Files:** `apps/miniapp-agents/src/pages/CampaignsPage.tsx`

### Checkpoint: Phase 3
- [ ] Frontend builds without errors
- [ ] Campaign creation with recurrence works end-to-end
- [ ] Pause/resume/run-now from UI works

## Phase 4: Polish

- [ ] **Task 9: MCP tools for recurring campaigns**
  - **Acceptance:** MCP tools exist for listing recurring campaigns, pausing/resuming, viewing execution logs.
  - **Verify:** MCP calls return correct results.
  - **Files:** `bot/mcp/tools/campaigns.py` (new)

- [ ] **Task 10: i18n strings**
  - **Acceptance:** All new UI strings are added to translation files in English (en) and Arabic (ar).
  - **Verify:** No untranslated strings visible in UI.
  - **Files:** `apps/miniapp-agents/src/i18n/` locale files

## Final Checkpoint
- [ ] All acceptance criteria from spec met
- [ ] Backend tests pass
- [ ] Frontend builds
- [ ] End-to-end flow: create recurring campaign → wait for trigger → verify job created → pause → resume → view history
