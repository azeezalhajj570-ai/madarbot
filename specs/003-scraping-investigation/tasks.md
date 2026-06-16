# Tasks: Scraping Flow Investigation & Optimization

**Input**: Design documents from `/specs/003-scraping-investigation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in spec — this is an investigation + optimization deliverable. Test tasks are included where regression prevention is critical.

**Organization**: Tasks are grouped by optimization priority (P0 → P3) mapped from research.md findings, plus setup and polish phases.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps to user story from spec.md (US1-US5) or optimization priority
- Include exact file paths in descriptions

## Path Conventions

- Backend: `bot/`
- Frontend dashboard: `bot/dashboard/frontend/`
- Miniapp: `apps/miniapp-agents/src/`
- Tests: `tests/`

---

## Phase 1: Investigation Verification (Setup)

**Purpose**: Confirm the investigation artifacts accurately represent the codebase

- [ ] T001 Verify all scraping-related files from research.md still exist and match documented behavior
- [ ] T002 Verify database indexes listed in data-model.md are present in `bot/db/models/scraper.py`
- [ ] T003 Verify API endpoint contracts in `contracts/scraper-api.md` match actual routes in `bot/dashboard/api/scraper.py`

---

## Phase 2: Baseline Tests (Foundational)

**Purpose**: Add regression tests for current scraping behavior before optimization changes

**⚠️ CRITICAL**: These tests lock in current correct behavior before any optimization changes

- [ ] T004 [P] Add bulk upsert dedup test for members in `tests/test_scraper_service.py` (verify existing test covers INSERT ON CONFLICT DO UPDATE)
- [ ] T005 [P] Add checkpoint state test: verify scrape_state JSON persistence/resume in `tests/test_scraper_service.py`
- [ ] T006 [P] Add conversation builder test: verify reply-thread and time-group logic in `tests/test_conversation_builder.py`

**Checkpoint**: Baseline tests pass — current behavior locked. All tests must pass before any optimization changes.

---

## Phase 3: P0 — Rate Limiting & N+1 Fix (US3: Performance Bottlenecks)

**Goal**: Eliminate the most impactful performance issues: missing rate limiting in member scrape and unnecessary sender resolution

**Independent Test**: Run `scrape_members()` on a 10k-member group without flood wait errors; verify `extract_message_sender_data()` skips network call when sender info already available

### Implementation

- [ ] T007 [P] [US3] Add configurable inter-request delay to `scrape_members()` in `bot/services/scraper_service.py` — add `asyncio.sleep(member_pause_seconds)` after each `iter_participants` page or every N members
- [ ] T008 [P] [US3] Add `resolve_sender: bool = True` parameter to `extract_message_sender_data()` in `bot/services/scrapers/entity_resolver.py` — when False, use `from_id`/`sender_id` directly without `await message.get_sender()` call
- [ ] T009 [US3] Pass `resolve_sender=False` from `scrape_messages()` and `scrape_messages_checkpointed()` in `bot/services/scraper_service.py` (depends on T008)
- [ ] T010 [US3] Add `scraper_member_pause_seconds` and `scraper_history_pause_seconds` defaults to `bot/config.py`
- [ ] T011 [US3] Verify no N+1 telethon calls remain: instrument a test scrape and count Telegram API calls per 100 messages

**Checkpoint**: Member scraping no longer hits flood waits; message scraping reduces sender-resolution API calls significantly

---

## Phase 4: P1 — Batch Conversations & Progress Events (US4: Progress/Error Tracking)

**Goal**: Batch conversation inserts and add real-time progress reporting

**Independent Test**: Scraping 5k messages produces conversation records via bulk upsert (single SQL per batch, not per thread); job progress updates visible before scrape completes

### Implementation

- [ ] T012 [US4] Implement `bulk_upsert_scraped_conversations()` in `bot/services/scrapers/bulk_upsert.py` using `INSERT ... ON CONFLICT (scraped_group_id, root_message_id) DO UPDATE` pattern
- [ ] T013 [US4] Replace individual `session.add()` calls in `build_conversations_from_scrape()` in `bot/services/scrapers/conversation_builder.py` with batch upsert (depends on T012)
- [ ] T014 [US4] Add progress updates to `scrape_messages_checkpointed()` and `scrape_messages()` in `bot/services/scraper_service.py` — update `AgentJob.job_payload["progress"]` after each batch flush with `{processed, total_expected, errors, last_batch_at}`
- [ ] T015 [US4] Add progress update to `scrape_members()` in `bot/services/scraper_service.py` — same pattern as T014
- [ ] T016 [US4] Display progress in dashboard scraper view — poll `AgentJob.job_payload["progress"]` in `bot/dashboard/frontend/index.html` scraper view

**Checkpoint**: Conversations use bulk upsert; scrape progress visible in dashboard during execution

---

## Phase 5: P2 — Incremental Scraping & Dedup (US5: Optimization Plan)

**Goal**: Add incremental-only mode to message scraping and member-count-based skip logic

**Independent Test**: Run scrape on already-scraped group with `only_new=True` and verify only messages with ID > max(DB) are fetched; run member scrape on group where count matches and verify skip

### Implementation

- [ ] T017 [US5] Add `only_new: bool = False` parameter to `scrape_messages()` in `bot/services/scraper_service.py` — when True, query `MAX(message_id)` from DB and use as `min_id` for `iter_messages()`
- [ ] T018 [US5] Add `only_new` support to `scrape_messages_checkpointed()` in `bot/services/scraper_service.py` — uses `last_scraped_message_id` from checkpoint as the resume point
- [ ] T019 [US5] Add member-count skip to `scrape_members()` in `bot/services/scraper_service.py` — if `scraped_group.member_count == entity.participants_count` and `force=False`, return early with "up_to_date" status
- [ ] T020 [US5] Expose `only_new` and `force_rescrape` as API parameters in `ScrapeMessagesRequest` and `ScrapeMembersRequest` in `bot/dashboard/api/scraper.py`
- [ ] T021 [US5] Add `only_new` toggle to dashboard scraper form in `bot/dashboard/frontend/index.html`

**Checkpoint**: Re-scraping the same group fetches only new data, not the full history

---

## Phase 6: P3 — Heartbeat & Client Reuse (US5: Optimization Plan)

**Goal**: Prevent long scrapes from being detected as stale; avoid per-job Telethon reconnection overhead

**Independent Test**: Run a 3-hour scrape without the job being marked stale; run two consecutive scrape jobs with the same agent and verify only one Telethon connection created

### Implementation

- [ ] T022 [P] [US5] Add heartbeat to `_execute_agent_job_impl()` in `bot/agents/worker.py` — periodic `AgentJob.updated_at` update (e.g., every 60s via `asyncio.create_task`) during scraping
- [ ] T023 [P] [US5] Implement client keep-alive in `SessionManager` in `bot/agents/session.py` — maintain `_client_pool` and reuse connected clients across jobs for same agent_id (with TTL)
- [ ] T024 [US5] Integrate client reuse in `ScraperRuntime.execute()` in `bot/agents/runtime.py` — pass client through instead of creating new one (depends on T023)
- [ ] T025 [US5] Add `scraper_heartbeat_seconds` config to `bot/config.py`
- [ ] T026 [US5] Verify stale detection: set `STALE_JOB_THRESHOLD_HOURS` to a test-appropriate value and confirm heartbeat prevents false staleness

**Checkpoint**: Long scrapes survive without stale detection; repeat scrapes avoid reconnection delay

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation updates, performance validation, code quality

- [ ] T027 [P] Update `quickstart.md` with new configuration options (heartbeat, pause seconds, only_new)
- [ ] T028 [P] Run `ruff check` and `ruff format` on all modified files
- [ ] T029 [P] Run `mypy` type checking on all modified files
- [ ] T030 Run existing test suite: `pytest tests/ -v`
- [ ] T031 Run performance benchmark: scrape a test group with 1000 messages before/after changes, compare query counts and wall time
- [ ] T032 Verify constitution compliance: no N+1 queries remain (V), async I/O used (VI), container limits respected (VII)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Verify)**: No dependencies — can start immediately
- **Phase 2 (Tests)**: Depends on Phase 1 — confirm investigation accuracy first
- **Phase 3 (P0)**: Depends on Phase 2 — baseline tests must pass before changes
- **Phase 4 (P1)**: Depends on Phase 2 — can run in parallel with Phase 3
- **Phase 5 (P2)**: Depends on Phase 2 — can run in parallel with Phase 3, 4
- **Phase 6 (P3)**: Depends on Phase 2 — can run in parallel with Phase 3, 4, 5
- **Phase 7 (Polish)**: Depends on all optimization phases being complete

### Within Each Phase

- Config changes (T010, T025) can be done first in their phases
- Service logic before API changes before frontend changes
- Tests should pass after each phase checkpoint

### Parallel Opportunities

- Phases 3, 4, 5, 6 can all start after Phase 2 completes (different file sets)
- Within Phase 3: T007, T008 can run in parallel
- Within Phase 4: T012 (bulk upsert) before T013 (replace calls)
- Within Phase 5: T017, T018 are independent; T019 is independent
- Within Phase 6: T022, T023 can run in parallel
- Within Phase 7: T027, T028, T029 can all run in parallel

---

## Parallel Example: Phase 3 + Phase 4 Combined

```bash
# After Phase 2 completes, launch P0 and P1 in parallel:
Phase 3 (P0):
  Task: T007 "Add rate limiting to scrape_members() in bot/services/scraper_service.py"
  Task: T008 "Add resolve_sender param to extract_message_sender_data() in bot/services/scrapers/entity_resolver.py"

Phase 4 (P1):
  Task: T012 "Implement bulk_upsert_scraped_conversations() in bot/services/scrapers/bulk_upsert.py"
  Task: T014 "Add progress updates to scrape_messages_checkpointed() in bot/services/scraper_service.py"
```

---

## Implementation Strategy

### MVP First (P0 Fixes Only)

1. Complete Phase 1: Investigation verification
2. Complete Phase 2: Baseline tests
3. Complete Phase 3: P0 rate limiting + N+1 fix
4. **STOP and VALIDATE**: Run member scrape on large group, verify no flood waits
5. Deploy if ready

### Incremental Delivery

1. Phases 1+2 → Investigation verified, baseline tests pass
2. Phase 3 (P0) → Rate limiting + N+1 fix → Deploy (immediate impact)
3. Phase 4 (P1) → Batch conversations + progress → Deploy (UX improvement)
4. Phase 5 (P2) → Incremental scraping → Deploy (efficiency)
5. Phase 6 (P3) → Heartbeat + client reuse → Deploy (reliability)
6. Phase 7 → Polish → Final release

### Single Developer Execution Order

1. T001-T003: Verify investigation is accurate
2. T004-T006: Write/verify baseline tests
3. T007-T011: P0 fixes (highest impact)
4. T012-T016: P1 fixes
5. T017-T021: P2 fixes
6. T022-T026: P3 fixes
7. T027-T032: Polish and validate

---

## Notes

- [P] tasks = different files, no dependencies on other in-progress tasks
- [US3], [US4], [US5] labels map tasks to spec user stories
- Phases 3-6 correspond to P0-P3 optimization priorities from research.md
- Each phase checkpoint validates independently before proceeding
- Commit after each phase or logical task group
- The investigation itself (research.md, data-model.md, contracts/) is already complete — these tasks focus on implementing the recommended optimizations
