# Data Model: AI Pilot Plugin

## Overview

The AI Pilot plugin does NOT require new database tables. It reuses the existing schema:

- **Plugin toggle**: `plugins_enabled` table (scoped by agent's linked `group_id`)
- **Settings**: `group_settings` table via `SettingsService` (scoped by agent's linked `group_id`)
- **Rate limiting**: Redis sorted sets (no DB)
- **Conversation cache**: Redis LRU (no DB)
- **Logging**: Structured logging via `structlog` (no DB)

## Entity Relationships

```
Agent (agents)
  │
  ├── group_id FK ──► Group (groups)
  │                    │
  │                    ├── plugin_enabled (plugins_enabled)
  │                    └── settings (group_settings)
  │
  └── telegram_user_id  ← Used to identify DM sender
```

## Scoping Strategy

Since `PluginEnabled` and `SettingsService` are scoped by `group_id`, the plugin uses the agent's `group_id` FK as the scope:

1. On DM receive, resolve the agent by looking up the bot token
2. Find the agent's `group_id`
3. Use that `group_id` to check `PluginEnabled` and read `SettingsService`

If an agent has no linked group, the plugin falls back to the global `AI_PILOT_ENABLED` env var only.

## Settings Schema

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `ai_pilot_enabled` | toggle | `false` | Per-agent enable/disable (overrides global if set) |
| `ai_pilot_system_prompt` | text | `""` | Custom system prompt for the AI (empty = use default) |
| `ai_pilot_max_history` | number | `10` | Max conversation messages to include as context (1-50) |
| `ai_pilot_rate_limit_max` | number | `5` | Max replies per user per window |
| `ai_pilot_rate_limit_window_s` | number | `60` | Rate limit window in seconds |

## No Migration Required

Since no new tables or columns are added, no Alembic migration is needed. All configuration is stored via the existing `group_settings` key-value table and `plugins_enabled` table.
