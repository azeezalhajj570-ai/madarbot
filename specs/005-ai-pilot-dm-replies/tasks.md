# Tasks: AI Pilot — Intelligent Auto-Reply Plugin for Agent DM Conversations

**Input**: Design documents from `specs/005-ai-pilot-dm-replies/`

**Prerequisites**: plan.md, spec.md, data-model.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)

---

## Phase 1: Foundation — Config & Plugin Scaffold

**Purpose**: Env var, plugin package structure, settings schema

**Blocks**: All other phases

- [ ] T001 [P] Add `AI_PILOT_ENABLED` env var (default `false`) in `bot/config.py` alongside existing AI settings
- [ ] T002 [P] Create `bot/plugins/ai_pilot/__init__.py` (empty package init)
- [ ] T003 [P] Create `bot/plugins/ai_pilot/schema.py` with `SETTINGS_SCHEMA` containing `ai_pilot_enabled`, `ai_pilot_system_prompt`, `ai_pilot_max_history`, `ai_pilot_rate_limit_max`, `ai_pilot_rate_limit_window_s` using `SettingSchema` from `bot/schemas/settings.py`
- [ ] T004 Create `bot/plugins/ai_pilot/plugin.py` with `AIPilotPlugin` class skeleton: manifest, `setup()` (registers router), `teardown()` (unregisters router), settings_schema, `plugin` module-level instance

**Checkpoint**: Plugin loads cleanly via PluginManager (even if handlers are no-ops). Settings appear in schema catalog.

---

## Phase 2: AI Chat Provider (US1, US4)

**Purpose**: Extend existing AI infrastructure with open-ended chat capability

**Depends on**: Phase 1 (T004 for plugin skeleton)

- [ ] T005 Create `bot/plugins/ai_pilot/provider.py` with `AIPilotProvider` abstract base class defining `async def chat(messages: list[dict], system_prompt: str) -> str`
- [ ] T006 [P] [US1] Implement `OpenAIPilotProvider` in `provider.py` — calls OpenAI chat completions endpoint `POST /v1/chat/completions` with `messages` array (system + user messages), returns `choices[0].message.content`
- [ ] T007 [P] [US1] Implement `GeminiPilotProvider` in `provider.py` — calls Gemini generateContent API with conversation context, returns text
- [ ] T008 [P] [US1] Implement `HeuristicPilotProvider` in `provider.py` — returns static fallback reply when `AI_PROVIDER=heuristic` or when API fails
- [ ] T009 [US1] Create `build_pilot_provider()` factory function in `provider.py` that reads `AI_PROVIDER` and API keys from `get_settings()` and returns the appropriate provider instance
- [ ] T010 [US4] Add error handling to all providers: catch `httpx.TimeoutException`, `httpx.HTTPStatusError`, and JSON parse failures; raise `AIPilotError` (new exception class in `provider.py`)

**Checkpoint**: Provider factory returns a working chat provider for each AI provider type. Error handling covers timeouts and 5xx.

---

## Phase 3: Service Layer — Reply Generation (US1)

**Purpose**: Conversation history retrieval, prompt assembly, provider dispatch, auto-send

**Depends on**: Phase 2 (T009 for provider factory)

- [ ] T011 Create `bot/plugins/ai_pilot/service.py` with `AIPilotService` class taking `session`, `bot`, `provider`, and `settings` as constructor args
- [ ] T012 [US1] Implement `get_conversation_history(user_id: int, max_messages: int) -> list[dict]` — queries recent messages from DB or Redis cache for the given user, returns `[{"role": "user"|"assistant", "content": "..."}]`
- [ ] T013 [US1] Implement `build_messages(history, current_text, system_prompt) -> list[dict]` — assembles system message + truncated history + current user message into the format expected by the AI provider
- [ ] T014 [US1] Implement `generate_reply(user_id: int, text: str) -> str` — main flow: retrieve history → build messages → call provider.chat() → return reply text
- [ ] T015 [US1] Implement `handle_dm(message: Message) -> None` — entry point: check global enabled → check per-group enabled → call generate_reply → send reply via `bot.send_message(chat_id, text)`
- [ ] T016 Add structured logging: `ai_pilot_reply_generated` (user_id, latency_ms, provider), `ai_pilot_reply_failed` (user_id, error), `ai_pilot_api_error` (provider, status_code, error)

**Checkpoint**: Service can be instantiated and `handle_dm()` produces an AI reply for a DM message.

---

## Phase 4: Rate Limiting (US3)

**Purpose**: Prevent spam/abuse by limiting replies per user per time window

**Depends on**: Phase 3 (integrates into `handle_dm`)

- [ ] T017 Create `bot/plugins/ai_pilot/rate_limiter.py` with `AIPilotRateLimiter` class using Redis sorted sets (following `bot/utils/rate_limiter.py` pattern)
- [ ] T018 [US3] Implement `is_allowed(user_id: int, max_replies: int, window_seconds: int) -> bool` — adds current timestamp to sorted set, trims old entries, returns `True` if count ≤ max_replies
- [ ] T019 [US3] Integrate rate limiter check into `AIPilotService.handle_dm()` — call `is_allowed()` before `generate_reply()`; if denied, log `ai_pilot_rate_limited` and return without replying

**Checkpoint**: Sending 10 rapid DM messages results in only N replies (N = configured max).

---

## Phase 5: Plugin Wiring — Router & Handler (US1, US2)

**Purpose**: Connect aiogram handler to private messages, enable/disable per-agent

**Depends on**: Phase 3 (T015 for handle_dm), Phase 4 (T019 for rate limiting)

- [ ] T020 [US1] In `bot/plugins/ai_pilot/plugin.py`, create an aiogram `Router` and register a handler for `F.chat.type == "private", F.text` that instantiates `AIPilotService` and calls `handle_dm(message)`
- [ ] T021 [US1] Wire `setup()` to `dispatcher.include_router(self._router)` and `teardown()` to remove the router
- [ ] T022 [US2] Add `_check_enabled(session, agent_group_id) -> bool` method to `AIPilotPlugin` that checks `PluginEnabled` table for the plugin name + agent's linked group_id
- [ ] T023 [US2] Integrate enable/disable check into the message handler — skip if plugin is not enabled globally (`AI_PILOT_ENABLED`) or per-agent
- [ ] T024 [US1] Add message deduplication guard — track `(user_id, message_id)` pairs in Redis with a short TTL (5s) to prevent duplicate handling from Telegram retries

**Checkpoint**: The bot responds to private DMs when the plugin is enabled. Does NOT respond when disabled.

---

## Phase 6: Tests & Polish (All Stories)

**Purpose**: Verify all user stories independently

**Depends on**: Phase 5 (all implementation complete)

- [ ] T025 [P] [US1] Unit test: `OpenAIPilotProvider.chat()` returns expected reply for a mock HTTP response in `tests/plugins/test_ai_pilot_provider.py`
- [ ] T026 [P] [US1] Unit test: `GeminiPilotProvider.chat()` returns expected reply for a mock response
- [ ] T027 [P] [US1] Unit test: `HeuristicPilotProvider.chat()` returns fallback text
- [ ] T028 [P] [US4] Unit test: Provider factory returns HeuristicPilotProvider when `AI_PROVIDER=heuristic`
- [ ] T029 [P] [US4] Unit test: Provider raises `AIPilotError` on timeout (mock `httpx.TimeoutException`)
- [ ] T030 [P] [US1] Unit test: `AIPilotService.build_messages()` correctly assembles system + history + current message under max context length
- [ ] T031 [P] [US3] Unit test: `AIPilotRateLimiter.is_allowed()` returns `True` for first N calls and `False` for N+1 within the window
- [ ] T032 [P] [US3] Unit test: `AIPilotRateLimiter.is_allowed()` returns `True` again after window expires
- [ ] T033 [US1] Integration test: Full DM flow — mock Telegram update (private text message) → plugin handler processes it → bot sends reply (mock `bot.send_message`) in `tests/integration/test_ai_pilot.py`
- [ ] T034 [US2] Integration test: Plugin disabled — message received, no reply sent in `tests/integration/test_ai_pilot.py`
- [ ] T035 [P] Run `ruff check` and `mypy` on `bot/plugins/ai_pilot/` — zero errors
- [ ] T036 Manual: send DM to bot with plugin enabled, verify AI reply is received within 15 seconds

**Checkpoint**: All 4 user stories verified. Code quality gates pass.

---

## Phase Dependencies

- **Phase 1** (Foundation): No dependencies — can start immediately
- **Phase 2** (AI Chat Provider): Depends on Phase 1 (plugin skeleton exists)
- **Phase 3** (Service Layer): Depends on Phase 2 (provider factory)
- **Phase 4** (Rate Limiting): Depends on Phase 3 (integrates into handle_dm)
- **Phase 5** (Plugin Wiring): Depends on Phase 3 + Phase 4
- **Phase 6** (Tests): Depends on Phase 5 (all implementation complete)

## Parallel Opportunities

- T001, T002, T003 can run in parallel (different files in Phase 1)
- T006, T007, T008 can run in parallel (different provider implementations in Phase 2)
- T012, T013, T014 can run in parallel (different service methods in Phase 3)
- All tests (T025-T034) marked [P] can run in parallel once Phase 5 is complete
- Phases 3 and 4 have some overlap but Phase 4 logically depends on Phase 3's `handle_dm`

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Foundation
2. Complete Phase 2: AI Chat Provider
3. Complete Phase 3: Service Layer (skip rate limiting)
4. Minimal Phase 5: Wire handler (skip enable/disable check — use global env var only)
5. **STOP and VALIDATE**: Send DM to bot, verify AI reply
6. **MVP deployed** — bot responds to DMs with AI!

### Incremental Delivery

1. MVP (US1) → Bot responds to DMs
2. Add US2 → Enable/disable per-agent
3. Add US3 → Rate limiting prevents abuse
4. Add US4 → Graceful fallback on API errors
5. Each story adds value without breaking previous
