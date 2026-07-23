# Implementation Plan: Recurring Tasks Support for Scheduled Messages

## Overview

Extend the existing Campaign system to support recurring schedules (daily/weekly/monthly/custom cron). The scheduler loop will poll campaigns with active recurrence settings and automatically create/trigger jobs on schedule. All existing one-shot campaign functionality remains unchanged.

## Architecture Decisions

- **Add recurrence fields directly to `Campaign` model** — avoids a new table for schedule config, keeps everything in one place
- **New `CampaignRecurrenceLog` table** for execution history — one row per triggered run, linked to the created `AgentJob`
- **Extend `scheduler_loop()`** to also poll for due recurring campaigns (SELECT ... FOR UPDATE to prevent duplicates)
- **Reuse existing `CampaignService.launch_campaign()`** for triggering — each recurrence run creates an `AgentJob` per target group exactly like a manual send
- **Frontend integrated into CampaignsPage** — recurrence fields appear inline when "Recurring" toggle is enabled, with sensible defaults

## Dependency Graph

```
Phase 1: Foundation (Ordered)
  1. DB migration — add recurrence columns to `campaigns`, create `campaign_recurrence_logs`
  2. Update Campaign model + service `_to_dict()`
  3. Update Campaign API endpoints to accept/return recurrence fields

Phase 2: Scheduler (Ordered)
  4. Add `process_recurring_campaigns()` to scheduler loop
  5. Create recurrence logging in `campaign_recurrence_logs`
  6. Add pause/resume/run-now endpoints

Phase 3: Frontend (Ordered)
  7. Update TypeScript types (Campaign interface + new API response types)
  8. Add reusable SchedulePicker component
  9. Integrate into CampaignsPage with recurrence toggle
  10. Add execution history view

Phase 4: Polish
  11. MCP tools for recurring campaign management
  12. i18n strings for new UI elements
```

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scheduler dispatches duplicate jobs for same campaign | High | Use `SELECT ... FOR UPDATE` + optimistic locking on `next_run_at` |
| Timezone edge cases (DST, invalid time) | Medium | Use IANA tz database via `zoneinfo`; validate timezone on save |
| Recurring campaign never ends (infinite loop bug) | Medium | Enforce `max_runs` default from `end_type`; add safety cap at 10,000 runs |
| Old campaigns with null recurrence fields break | Low | Backward-compatible: null fields = no recurrence (existing behavior) |
