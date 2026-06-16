# Implementation Plan: Scraping Flow Investigation

**Branch**: `004-scraping-flow-investigation` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-scraping-investigation/spec.md`

## Summary

Conduct a deep-dive technical investigation of the Telegram group scraping pipeline — from UI trigger through job creation, Telethon-based execution, database persistence, progress tracking, and error handling. Produce a documented map of the current flow with concrete optimization recommendations. This is a **read-only investigation**; no code changes are made.

## Technical Context

**Language/Version**: Python 3.11+

**Primary Dependencies**: FastAPI, Dramatiq, Telethon, SQLAlchemy (async), python-telegram-bot

**Storage**: PostgreSQL 16 (via asyncpg), Redis 7 (Dramatiq broker + cache)

**Testing**: pytest + pytest-asyncio

**Target Platform**: Linux server (Docker containers)

**Project Type**: Web application — backend (Python/FastAPI) + frontend dashboard (Jinja2/SPA) + React miniapp

**Performance Goals**: Scraping jobs must complete within 24h timeout (Dramatiq `time_limit`), no N+1 query patterns, 500ms p95 for API reads

**Constraints**: Async-first architecture, Telethon flood wait tolerance, containerized via Docker Compose, constitution compliance

**Scale/Scope**: Groups with thousands of members, millions of messages; single agent_worker service processes all scraping jobs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Security & Secrets | PASS | Investigation is read-only; no new secrets or credentials |
| II. Code Quality | PASS | No code changes — documentation only |
| III. Testing Standards | PASS | Investigation scope does not include code changes requiring tests |
| IV. User Experience Consistency | PASS | No UI changes in scope |
| V. Performance Requirements | **INVESTIGATE** | Core focus: identify N+1 patterns, batch insert gaps, index coverage, memory usage — all constitution requirements |
| VI. Async-First & Event-Driven | **INVESTIGATE** | Verify scraping workers are fully async, no blocking calls in Telethon usage |
| VII. Containerized Infrastructure | PASS | Scraper runs in `agent_worker` Docker service — covered in investigation |
| VIII. Structured Observability | PASS | Job status tracking, notifications, and error logging are investigation targets |

**Gate Result**: PASS — No blocking violations. Two INVESTIGATE items mapped to Phase 0 research tasks.

## Project Structure

### Documentation (this feature)

```text
specs/003-scraping-investigation/
├── plan.md              # This file
├── research.md          # Phase 0 output — identified patterns, bottlenecks, gaps
├── data-model.md        # Phase 1 output — database schema map for scraper tables
├── quickstart.md        # Phase 1 output — onboarding guide for scraper internals
├── contracts/           # Phase 1 output — API contract reference (scraper endpoints)
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created by /speckit.plan)
```

### Source Code (repository root) — Scraping Subsystem

```text
bot/
├── agents/
│   ├── worker.py                    # Dramatiq actors: execute_agent_job, build_conversations_actor
│   ├── runtime.py                   # ScraperRuntime, AddContactRuntime, GroupMemberBroadcastRuntime
│   ├── dispatch.py                  # dispatch_agent_job(), reconcile_stale_jobs()
│   ├── jobs.py                      # Job type constants (SCRAPER_FULL_GROUP, etc.)
│   ├── session.py                   # SessionManager — Telethon client pool
│   ├── auth.py                      # Agent authentication via Telethon
│   ├── listener.py                  # Agent event listener (Telethon message events)
│   ├── group_membership.py          # Telethon group join/leave operations
│   └── account_group_membership_service.py  # scrape_agent_member_group(), member listing
├── services/
│   ├── scraper_service.py          # ScraperService — all scraping logic (1657 lines)
│   ├── knowledge_extractor.py      # AI knowledge extraction from scraped messages
│   ├── agent_lead_service.py       # Lead capture from scraped/automation data
│   └── scrapers/
│       ├── __init__.py             # Subpackage init
│       ├── entity_resolver.py      # Group entity resolution, sender extraction
│       ├── serializers.py          # Participant/message → DB row builders
│       ├── bulk_upsert.py          # PostgreSQL INSERT ... ON CONFLICT DO UPDATE
│       └── conversation_builder.py # ScrapedConversation thread builder
├── db/
│   └── models/
│       ├── scraper.py              # ScrapedGroup, ScrapedMessage, ScrapedMember, ScrapedConversation,
│       │                            # ScrapedDailySummary, GroupKnowledge, ScrapedLead (7 models)
│       └── agent.py                # AgentJob model (job queue)
├── dashboard/
│   └── api/
│       ├── scraper.py              # /webapp/scraper/* API router (scraping endpoints)
│       └── routers/agents.py       # /webapp/agents/{id}/jobs (job creation + listing)
├── workers/
│   ├── app.py                      # Dramatiq RedisBroker setup
│   └── tasks.py                    # Background task actors
└── run_scraper_service.py          # CLI entry point: dramatiq bot.agents.worker

apps/miniapp-agents/src/
├── features/leads/
│   └── LeadsAcquisitionSection.tsx # Mini-app scraper UI ("Leads Acquisition")
├── pages/
│   └── CampaignsPage.tsx           # Campaign scrape trigger button
├── components/
│   └── GroupAnalysisPage.tsx       # Scraped group analysis + knowledge display
└── App.tsx                         # Job type labels, scrape notifications

tests/
└── test_scraper_service.py         # Bulk upsert dedup tests
```

**Structure Decision**: The scraping subsystem follows the repo's established pattern: API routers → services (with subpackages for complex domains) → async workers. Models live under `db/models/` with Alembic migrations. Frontend scraping UI is split between the Jinja2 dashboard SPA and the React miniapp.

## Complexity Tracking

> No constitution violations to justify. The investigation is read-only and follows existing architecture patterns.
