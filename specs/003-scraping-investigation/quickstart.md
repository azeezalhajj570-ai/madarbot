# Quickstart: Scraping System Internals

**Feature**: [Scraping Flow Investigation](./spec.md)
**Date**: 2026-06-16

## For Developers Onboarding to the Scraping Code

### Where to start reading

1. **API entry points**: `bot/dashboard/api/scraper.py` — all 20+ scraping endpoints
2. **Job creation and dispatch**: `bot/agents/dispatch.py` — `dispatch_agent_job()` enqueues to Dramatiq
3. **Worker actor**: `bot/agents/worker.py` — `execute_agent_job` Dramatiq actor, exception handling, notifications
4. **Runtime orchestrator**: `bot/agents/runtime.py` — `ScraperRuntime.execute()` dispatches by job_type to `ScraperService`
5. **Core scraping logic**: `bot/services/scraper_service.py` (1657 lines) — `scrape_members()`, `scrape_messages()`, `scrape_messages_checkpointed()`, `scrape_full_group()`
6. **Telethon client management**: `bot/agents/session.py` — `SessionManager` client pool
7. **Entity resolution**: `bot/services/scrapers/entity_resolver.py` — group lookup, sender extraction
8. **Bulk writes**: `bot/services/scrapers/bulk_upsert.py` — PostgreSQL `INSERT ... ON CONFLICT DO UPDATE`
9. **Database models**: `bot/db/models/scraper.py` — all 7 scraper tables with indexes and constraints

### Key files at a glance

| File | Purpose | Lines |
|------|---------|-------|
| `bot/services/scraper_service.py` | All scraping operations | 1657 |
| `bot/dashboard/api/scraper.py` | Scraper API router | 1018 |
| `bot/agents/runtime.py` | ScraperRuntime + broadcast/contact runtimes | 1017 |
| `bot/agents/worker.py` | Dramatiq actors + notifications | 625 |
| `bot/agents/listener.py` | Agent event listener (references ScraperService) | 438 |
| `bot/services/knowledge_extractor.py` | AI knowledge extraction | 404 |
| `bot/services/scrapers/entity_resolver.py` | Group resolution, sender extraction | 231 |
| `bot/db/models/scraper.py` | Scraper ORM models | 220 |
| `bot/services/scrapers/conversation_builder.py` | Conversation thread builder | 165 |
| `bot/services/scrapers/serializers.py` | Message/member row builders | ~150 |
| `bot/services/scrapers/bulk_upsert.py` | Bulk upsert utilities | 104 |
| `bot/agents/dispatch.py` | Job dispatch + stale reconciliation | 87 |
| `bot/agents/jobs.py` | Job type constants | ~40 |

### How to trigger a scrape

**Via Dashboard (Jinja2 SPA)**:
1. Navigate to `/webapp/` → Scraper tab
2. Select executor (Bot/Agent), choose agent, enter group ID
3. Click "Scrape" → `POST /webapp/scraper/scrape/full-group`
4. Job created → dispatched to Dramatiq → worker executes → result stored

**Via Mini-App (React)**:
1. Open Leads Acquisition section
2. Search and select a group
3. Set member/message limits, click submit
4. Calls `agentsAPI.createAgentJob()` with `scraper_full_group`

**Via API (curl)**:
```bash
curl -X POST "https://madar.hamedco.com/webapp/scraper/scrape/full-group" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"agent_id": 123, "tg_group_id": -1001234567890, "member_limit": 1000, "message_limit": 100}'
```

### Running locally

```bash
# Start the agent worker (processes scraping jobs)
docker compose up agent_worker

# Or run directly
python -m bot.main          # for agent mode
dramatiq bot.agents.worker  # for worker only
```

### Testing

```bash
# Run scraper-specific tests
pytest tests/test_scraper_service.py -v

# Test upsert deduplication
pytest tests/test_scraper_service.py::test_scraper_bulk_upserts_replace_existing_rows_without_duplicates -v
```

### Debugging tips

- **Check job status**: `SELECT id, job_type, status, job_payload FROM agent_jobs WHERE job_type LIKE 'scraper%' ORDER BY id DESC LIMIT 10;`
- **View scraper logs**: `docker compose logs --tail=200 agent_worker | grep -E "scrape|scraper"`
- **Check checkpoint state**: `SELECT tg_group_id, title, scrape_state FROM scraped_groups WHERE scrape_state IS NOT NULL;`
- **Check stale jobs**: Jobs in `pending`/`queued` > 2h are marked stale by `reconcile_stale_jobs()`
- **Flood wait inspection**: Look for `scraper_flood_wait` or `agent_job_flood_wait` log events
- **Trace a job**: Follow `job_id` through logs: `agent_job_started` → `scraper_fetching` → `scraper_checkpoint_saved` / `agent_job_succeeded`
