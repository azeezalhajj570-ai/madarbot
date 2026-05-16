# Tasks: CRM-Style Campaigns for Broadcast Messaging

**Input**: Design documents from `specs/001-crm-campaigns/`

**Prerequisites**: plan.md, spec.md, data-model.md, contracts/campaigns.openapi.yaml

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Data Model (Foundation)

**Purpose**: Campaign table + migration + FK additions

**Blocks all user stories**

- [ ] T001 [P] Create `Campaign` model in `bot/db/models/campaign.py`
- [ ] T002 [P] Add `campaign_id` FK to `AgentJob` in `bot/db/models/agent.py`
- [ ] T003 [P] Add `campaign_id` FK to `SentBroadcastMessage` in `bot/db/models/agent.py`
- [ ] T004 [P] Export `Campaign` in `bot/db/models/__init__.py`
- [ ] T005 Generate Alembic migration for new table and FKs
- [ ] T006 Run migration to verify

**Checkpoint**: Campaign table exists, FKs in place, backward compatible.

---

## Phase 2: Service Layer (US1 + US2)

**Purpose**: Campaign CRUD + send orchestration service

- [ ] T007 Create `CampaignService` in `bot/services/campaign_service.py` with:
  - `create_campaign()` — creates draft campaign
  - `get_campaign()` — single campaign with stats
  - `list_campaigns()` — paginated list by agent
  - `update_campaign()` — only if draft
  - `delete_campaign()` — only if draft
- [ ] T008 [P] Add `launch_campaign()` method — creates AgentJob per target group, stamps campaign_id
- [ ] T009 [US2] Modify `compute_bulk_exclusions()` in `bot/agents/agent_job_service.py` to check cross-group dedup when campaign_id is present
- [ ] T010 [US2] Stamp `campaign_id` on `SentBroadcastMessage` when creating rows during a campaign send

**Checkpoint**: Campaign CRUD works programmatically. Cross-group dedup logic ready.

---

## Phase 3: API Endpoints (US1)

**Purpose**: Campaign CRUD endpoints for frontend

- [ ] T011 Create router `bot/dashboard/api/routers/campaigns.py` with:
  - `POST /webapp/agents/{agent_id}/campaigns` — create
  - `GET /webapp/agents/{agent_id}/campaigns` — list
  - `GET /webapp/agents/{agent_id}/campaigns/{id}` — detail
  - `PATCH /webapp/agents/{agent_id}/campaigns/{id}` — update
  - `DELETE /webapp/agents/{agent_id}/campaigns/{id}` — delete
- [ ] T012 Mount campaigns router in `bot/dashboard/api/main.py`

**Checkpoint**: Campaign CRUD accessible via API.

---

## Phase 4: Send & Logs Endpoints (US2 + US3)

**Purpose**: Campaign send trigger + send-log filtering

- [ ] T013 [US2] Add `POST /webapp/agents/{agent_id}/campaigns/{id}/send` — launches campaign
- [ ] T014 [US3] Add `GET /webapp/agents/{agent_id}/campaigns/{id}/send-logs` — paginated send logs filtered by campaign_id
- [ ] T015 [US3] Add send-log filtering by status (`sent`, `failed`, `skipped`) query param

**Checkpoint**: Campaign send + send-log filtering works via API.

---

## Phase 5: Frontend (US1 + US3)

**Purpose**: Campaign creation UI + send-log display in CampaignsPage

- [ ] T016 [US1] Add campaign create form to `apps/miniapp-agents/src/pages/CampaignsPage.tsx`
- [ ] T017 [US3] Add campaign send-log table view (filtered by campaign)
- [ ] T018 [P] Add campaign API client methods to `packages/miniapp-shared/src/api/agents.ts`
- [ ] T019 [P] Add campaign TypeScript types to `packages/miniapp-shared/src/types/index.ts`

**Checkpoint**: Campaign create + send-logs visible in UI.

---

## Phase 6: Tests & Polish

**Purpose**: Verify correctness and backward compatibility

- [ ] T020 [US1] Test: create campaign successfully
- [ ] T021 [US2] Test: cross-group duplicate user is skipped within same campaign
- [ ] T022 [US2] Test: same user can receive messages from different campaigns
- [ ] T023 [US2] Test: null campaign_id preserves existing dedup behavior
- [ ] T024 [US3] Test: campaign send-log endpoint returns only logs for that campaign

**Checkpoint**: All acceptance criteria verified.

---

## Phase Dependencies

- **Phase 1** (Data Model): No dependencies — can start immediately
- **Phase 2** (Service): Depends on Phase 1
- **Phase 3** (API): Depends on Phase 2 (US1) — can start in parallel with Phase 4
- **Phase 4** (Send/Logs): Depends on Phase 2 (US2/US3) — can start in parallel with Phase 3
- **Phase 5** (Frontend): Depends on Phase 3 + Phase 4
- **Phase 6** (Tests): Depends on Phase 2 + Phase 3 + Phase 4
