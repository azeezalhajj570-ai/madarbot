# Implementation Plan: AI Pilot — Intelligent Auto-Reply Plugin for Agent DM Conversations

**Branch**: `005-ai-pilot-dm-replies` | **Date**: 2026-06-17 | **Spec**: `specs/005-ai-pilot-dm-replies/spec.md`

**Input**: Feature specification from `specs/005-ai-pilot-dm-replies/spec.md`

## Summary

Add a new plugin `bot/plugins/ai_pilot/` that subscribes to private (DM) text messages via an aiogram router. When a user sends a DM to the bot, the plugin retrieves recent conversation history, calls the configured AI provider (OpenAI/Gemini/OpenRouter) to generate a contextual reply, and auto-posts it back to the DM. Per-agent enable/disable stored via plugin settings. Rate limiting prevents abuse.

## Technical Context

**Language/Version**: Python 3.11+

**Primary Dependencies**: aiogram 3.x, httpx, SQLAlchemy (async), Redis

**Storage**: PostgreSQL 16 (plugin settings via `SettingsService`), Redis (rate limiting, conversation cache)

**Testing**: pytest + pytest-asyncio

**Target Platform**: Linux server (Docker)

**Project Type**: Web application (FastAPI backend + Telegram bot)

**Performance Goals**: AI reply generated and sent within 15s p95 (dominated by AI API latency)

**Constraints**: Existing AI provider classes (`OpenAIProvider`/`GeminiProvider` from `bot/ai/providers.py`) only support classification — a new `chat()` method or a dedicated chat provider is needed. Must NOT block the async event loop. Must follow existing plugin conventions.

**Scale/Scope**: Handles DM messages for one bot instance. No horizontal scaling concerns. Rate limited per-user.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Security & Secrets | ✅ Pass | Uses existing `OPENAI_API_KEY` env var; no new secrets |
| II. Code Quality | ✅ Pass | Plugin follows existing plugin conventions; ruff + mypy required |
| III. Testing Standards | ✅ Pass | Tests included in task breakdown |
| IV. UX Consistency | ✅ Pass | AI replies use bot-native message format; structured logging |
| V. Performance | ✅ Pass | AI call is async (httpx.AsyncClient); rate limiting via Redis |
| VI. Async-First | ✅ Pass | All I/O uses asyncio |
| VII. Containerized | ✅ Pass | Plugin is part of bot container; no new services |
| VIII. Observability | ✅ Pass | Structured logging events: `ai_pilot_reply_generated`, `ai_pilot_reply_failed`, `ai_pilot_rate_limited` |

## Project Structure

### Documentation (this feature)

```text
specs/005-ai-pilot-dm-replies/
├── spec.md              # Feature specification
├── plan.md              # This file
├── data-model.md        # Entity definitions (Phase 1)
└── tasks.md             # Implementation tasks (Phase 2)
```

### Source Code

```text
bot/
├── plugins/
│   └── ai_pilot/              # NEW: plugin package
│       ├── __init__.py         # Package init
│       ├── plugin.py           # Plugin lifecycle (setup/teardown), router, handler
│       ├── provider.py         # AI chat provider (OpenAI/Gemini/OpenRouter chat interface)
│       ├── schema.py           # Plugin settings schema
│       ├── service.py          # AI reply generation service
│       └── rate_limiter.py     # Per-user rate limiting
├── config.py                   # MOD: add AI_PILOT_ENABLED env var
└── db/
    └── models/
        └── plugin.py           # MOD: PluginEnabled may need agent_id scope (or reuse group_id)
```

**Structure Decision**: Single-project layout following the existing `bot/plugins/` convention. The plugin is self-contained in `bot/plugins/ai_pilot/` with its own router, provider, and service modules.

## Implementation Phases

1. **Plugin scaffold** — `__init__.py`, `plugin.py`, `schema.py`; manifest + settings schema
2. **AI chat provider** — `provider.py`; extends existing AI infrastructure with chat/response capability
3. **Service layer** — `service.py`; conversation history retrieval, prompt building, provider dispatch
4. **Rate limiting** — `rate_limiter.py`; per-user Redis rate limiter
5. **Private message router** — Register aiogram handler for `F.chat.type == "private"` in `plugin.py`
6. **Config & env vars** — Add `AI_PILOT_ENABLED` to `bot/config.py`
7. **Tests** — Unit tests for provider, service, and rate limiter; integration test for end-to-end DM flow
8. **Polish** — Structured logging, error handling, edge cases

## Key Design Decisions

1. **Router approach**: The plugin registers its own aiogram Router with `F.chat.type == "private", F.text` handlers, rather than depending on the EventBus (which currently only fires for group messages). This is self-contained and follows aiogram's idiomatic pattern.
2. **AI provider extension**: The existing `OpenAIProvider` and `GeminiProvider` in `bot/ai/providers.py` are classification-only. A new `AIProvider.chat()` method or a dedicated `AIPilotProvider` class will be added to handle open-ended chat completions. The existing provider config (`AI_PROVIDER`, API keys, models) is reused.
3. **Conversation history**: Recent DM messages are fetched from the database (scraped or stored messages table) using `tg_user_id + chat_id` as the scope. If DB storage is not available, an in-memory Redis LRU cache is used as fallback. Default window: last 10 messages.
4. **Plugin settings scope**: The existing `PluginEnabled` table is scoped by `group_id` FK. For DM-based plugins, we use the agent's group association OR introduce a `plugin_name + scope_id` pattern. Decision: reuse group_id by associating the plugin with the agent's linked group. If no group exists, use global plugin enable/disable.
