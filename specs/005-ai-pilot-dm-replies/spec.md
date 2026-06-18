# Feature Specification: AI Pilot — Intelligent Auto-Reply Plugin for Agent DM Conversations

**Feature Branch**: `005-ai-pilot-dm-replies`

**Created**: 2026-06-17

**Status**: Draft

**Input**: User description: "AI pilot plugin that auto-replies to DM messages sent to connected agent accounts using existing AI providers (OpenAI/Gemini/OpenRouter), with recent DM conversation history as RAG context. Auto-send when enabled."

**GitHub Issue**: https://github.com/azeezalhajj570-ai/madarbot/issues/56

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Agent Responds to DM Messages with AI (Priority: P1)

As a user who sends a private message to a connected agent account, I want the agent to reply intelligently using AI, drawing on our previous conversation for context, so that I get helpful answers without human intervention.

**Why this priority**: This is the core feature — without DM replies there is no AI Pilot. All other stories build on this.

**Independent Test**: Can be fully tested by sending a DM to an agent account with the plugin enabled, and verifying the agent replies with a contextually relevant AI-generated message. Delivers immediate value as a conversational AI chatbot.

**Acceptance Scenarios**:

1. **Given** the AI Pilot plugin is enabled for an agent, **When** a user sends a private text message to that agent's Telegram account, **Then** the agent replies with an AI-generated response within 15 seconds.
2. **Given** a conversation exists with previous messages between the user and agent, **When** the user sends a new message, **Then** the AI reply references or acknowledges the earlier conversation context.
3. **Given** the AI Pilot plugin is disabled for an agent, **When** a user sends a private message, **Then** the agent does NOT reply (no AI response).

---

### User Story 2 — Plugin Enable/Disable per Agent Account (Priority: P1)

As an admin, I want to toggle the AI Pilot on or off per connected agent account, so that I can control which agents respond to DMs.

**Why this priority**: Without a way to enable/disable, the feature is either always-on or always-off, which is not production-viable.

**Independent Test**: Can be fully tested by toggling the plugin for a specific agent via the settings API/dashboard and verifying the agent starts or stops responding to DMs. Delivers admin control independently of the reply generation.

**Acceptance Scenarios**:

1. **Given** the plugin is disabled for an agent, **When** an admin enables it via the plugin settings API for that agent, **Then** the agent begins replying to incoming DMs.
2. **Given** the plugin is enabled for an agent, **When** an admin disables it, **Then** the agent stops replying to incoming DMs immediately.
3. **Given** the plugin is enabled globally (env var), **When** no agent-specific setting exists, **Then** the plugin uses the global default (disabled).

---

### User Story 3 — Rate Limiting to Prevent Spam (Priority: P2)

As a platform operator, I want the AI Pilot to limit how frequently it responds to the same user, so that excessive or abusive messaging does not flood AI API calls or annoy users.

**Why this priority**: Without rate limiting, a malicious or buggy user could trigger unlimited AI replies, costing money and creating a poor experience. It is a safety net, not the core feature.

**Independent Test**: Can be tested by sending 10 rapid DM messages to an agent and verifying that only N (configurable limit) replies are sent within the rate window. Delivers abuse protection independently of the reply generation.

**Acceptance Scenarios**:

1. **Given** the rate limit is 5 messages per minute per user, **When** a user sends 10 DM messages within one minute, **Then** the agent replies to only the first 5 and silently ignores the rest.
2. **Given** the rate window has expired, **When** the user sends a new message, **Then** replies resume normally.

---

### User Story 4 — AI Provider Fallback & Error Handling (Priority: P2)

As a platform operator, I want the AI Pilot to gracefully degrade when the AI API is unavailable, so that failures do not crash the bot or leave users hanging.

**Why this priority**: AI API failures are inevitable in production. Without graceful handling, users get no response and operators get noisy error logs.

**Independent Test**: Can be tested by misconfiguring the AI API key and sending a DM — the plugin should log a structured warning and NOT reply, without throwing an unhandled exception. Delivers resilience independently.

**Acceptance Scenarios**:

1. **Given** the AI provider API returns a 5xx error, **When** a DM is received, **Then** the plugin logs a structured warning (`ai_pilot_api_error`) and does not reply.
2. **Given** the AI provider times out after the configured `AI_REQUEST_TIMEOUT_SECONDS`, **When** a DM is received, **Then** the plugin logs a timeout warning and does not reply.
3. **Given** `AI_PROVIDER` is set to `heuristic`, **When** a DM is received, **Then** the plugin falls back to a simple static reply ("I'm currently unable to process your request. Please try again later.") and logs a fallback event.

---

### Edge Cases

- What happens when a user sends an empty message or only media/attachments with no text?
- What happens when the DM conversation history exceeds the AI model's context window?
- What happens when multiple users DM the same agent simultaneously?
- What happens when an agent account's bot token is revoked or invalid mid-conversation?
- What happens when the user blocks the bot mid-conversation?
- What happens when the AI provider returns non-English content but the group/user expects a specific language?
- What happens when a message triggers content that violates the AI provider's safety policies?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST register an aiogram message handler for private chat messages (`F.chat.type == "private"`, `F.text`) that only fires when the plugin is enabled for the relevant agent.
- **FR-002**: System MUST dispatch AI reply generation to the configured AI provider (OpenAI, Gemini, or OpenRouter) using the existing `AI_PROVIDER` and API key settings from `bot/config.py`.
- **FR-003**: System MUST retrieve the last N recent DM messages between the sender and the agent as conversation context for the AI prompt (N configurable, default 10).
- **FR-004**: System MUST auto-send the AI-generated reply directly to the DM chat (no draft/approval flow).
- **FR-005**: System MUST persist plugin enabled/disabled state per agent (identified by bot token or agent telegram user ID) using the existing `PluginEnabled` table or an equivalent mechanism.
- **FR-006**: System MUST enforce per-user rate limiting (configurable: max messages per time window) using Redis sorted sets, following the pattern in `bot/utils/rate_limiter.py`.
- **FR-007**: System MUST log structured events for every reply attempt: `ai_pilot_reply_generated`, `ai_pilot_reply_failed`, `ai_pilot_rate_limited`, `ai_pilot_api_error`.
- **FR-008**: System MUST handle AI provider errors (timeout, HTTP 4xx/5xx, empty response) gracefully without crashing the bot or leaking exceptions to the user.
- **FR-009**: System MUST support a global enable/disable flag via environment variable (`AI_PILOT_ENABLED`, default `false`).
- **FR-010**: System MUST include a system prompt instructing the AI to be helpful, concise, and truthful, with configurable overrides per agent.
- **FR-011**: System MUST skip non-text messages (photos, videos, stickers, etc.) — only process text messages.
- **FR-012**: System MUST use the agent's own bot token (from `bot/bot`) for sending replies, not the main bot token, to ensure replies come from the correct agent account.

### Key Entities

- **AIPilotConfig**: Per-agent plugin configuration. Attributes: `agent_id` (FK to agents table), `enabled` (bool), `model_override` (optional string), `system_prompt` (optional string), `max_history` (int, default 10), `rate_limit_max` (int), `rate_limit_window_seconds` (int). Stored as plugin settings via `SettingsService` or a dedicated table.
- **AIPilotReplyLog**: Optional audit record per reply. Attributes: `agent_id`, `sender_user_id`, `inbound_text` (truncated), `reply_text` (truncated), `provider`, `model`, `latency_ms`, `created_at`. Determined during planning whether a full table is needed vs structured logging.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An agent with the plugin enabled replies to DM messages within 15 seconds at p95 under normal AI API latency.
- **SC-002**: Rate limiting prevents more than the configured max replies per user within the configured window.
- **SC-003**: AI provider failures (timeout, 5xx) produce zero unhandled exceptions — all errors are logged and handled gracefully.
- **SC-004**: Plugin follows the same conventions as existing plugins (`faq`, `semantic_assistant`): manifest, settings schema, setup/teardown lifecycle, PluginEnabled table, discovery via `PluginManager`.
- **SC-005**: Existing group message processing and other plugins are completely unaffected — no regression in group message handling.

## Assumptions

- Connected agent accounts have valid, active Telegram bot tokens accessible to the bot runtime.
- The AI provider (OpenAI/Gemini/OpenRouter) is already configured and working (used by existing AI Receptionist and moderation features).
- DM conversation history is retrievable via the bot's message storage or by keeping an in-memory/Redis cache of recent messages per sender-agent pair. [NEEDS CLARIFICATION: Should conversation history be stored in DB, Redis cache, or fetched from Telegram API on each message?]
- The plugin is scoped to the agent's bot token, meaning each connected Telegram account acts as its own AI Pilot instance.
- Group message scope (group chats) is explicitly out of scope for v1 — only private/DM messages are handled.
- The `PluginEnabled` table and `SettingsService` will be reused for per-agent configuration rather than creating a completely new storage mechanism. [NEEDS CLARIFICATION: PluginEnabled is currently scoped by group_id, not agent_id. May need a PluginAgentEnabled table or repurpose PluginEnabled with agent_id FK.]
