# Implementation Plan: CRM-Style Campaigns for Broadcast Messaging

**Branch**: `001-crm-campaigns` | **Date**: 2026-05-16 | **Spec**: `specs/001-crm-campaigns/spec.md`

**Input**: Feature specification from `specs/001-crm-campaigns/spec.md`

## Summary

Add a `Campaign` entity to group multiple broadcast `AgentJob` records under one coordinated send. Implement cross-group deduplication so a user in multiple target groups receives the campaign message only once. Add campaign CRUD endpoints and send-log filtering.

## Technical Context

**Language/Version**: Python 3.11

**Primary Dependencies**: FastAPI, SQLAlchemy 2.0, Alembic

**Storage**: PostgreSQL 16

**Testing**: pytest

**Target Platform**: Linux server (Docker)

**Project Type**: Web application (FastAPI backend + React SPA frontend)

## Project Structure

### Documentation (this feature)

```
specs/001-crm-campaigns/
├── spec.md                  # Feature spec
├── plan.md                  # This file
├── data-model.md            # Entity definitions
├── contracts/
│   └── campaigns.openapi.yaml  # API contract
└── tasks.md                 # Implementation tasks
```

### Source Code

```
bot/
├── db/models/
│   ├── campaign.py           # NEW: Campaign model
│   └── agent.py              # MOD: add campaign_id FK to AgentJob, SentBroadcastMessage
├── services/
│   └── campaign_service.py   # NEW: Campaign CRUD + send logic
├── dashboard/api/routers/
│   └── campaigns.py          # NEW: campaign API endpoints
├── agents/
│   └── agent_job_service.py  # MOD: cross-group dedup in compute_bulk_exclusions
```

## Phases

1. **Data model** — Campaign table, migration, FKs on AgentJob + SentBroadcastMessage
2. **Service layer** — CampaignService with CRUD + send orchestration
3. **API endpoints** — Campaign routes mounted on FastAPI
4. **Dedup logic** — Cross-group dedup in existing exclusion flow
5. **Frontend** — Enhance CampaignsPage with campaign creation and send-logs view
6. **Polish** — Tests, edge cases, backward compatibility check
