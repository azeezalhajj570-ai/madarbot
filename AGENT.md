# MadarBot AI Agent Guide

## Purpose
MadarBot is an AI-powered Telegram automation platform focused on:
- Telegram group monitoring
- Lead capture
- Automated agent workflows
- AI-assisted replies
- Task execution pipelines
- MCP server for external AI agent control

## Runtime Modes
The application supports:
- BOT_APP_KIND=agents
- bot listener mode
- agent worker mode
- MCP server (JSON-RPC over HTTP at /mcp/)

## Core Responsibilities
AI agents should:
1. Listen to Telegram group messages
2. Detect trigger phrases
3. Execute automation tasks
4. Persist captured leads
5. Avoid duplicate lead insertion
6. Maintain healthy Telegram sessions
7. Retry failed transient jobs
8. Expose MCP tools for external agent control when enabled

## Required Environment Variables
- TELEGRAM_API_ID
- TELEGRAM_API_HASH
- DATABASE_URL
- REDIS_URL
- BOT_APP_KIND
- DEFAULT_LANGUAGE
- MCP_ENABLED (optional, set to "true" to enable the MCP endpoint)
- MCP_AUTH_TOKEN (optional, fallback auth token)
- OPENAI_API_KEY (for AI reply features)

## Lead Capture Rules
- Persist all valid lead_capture events
- Deduplicate by:
  - group_id
  - tg_user_id
  - source_group_tg_id
- Support nullable agent_id for bot-originated tasks

## MCP Server

### Endpoint
- POST /mcp/ — JSON-RPC 2.0 (tools/list, tools/call, initialize)
- GET /mcp/ — returns initialize payload (ChatGPT compatibility)

### Authentication
- Bearer token via `Authorization` header or `?token=` query param
- DB-backed tokens in `mcp_tokens` table (primary; extracts tg_user_id)
- Env fallback: `MCP_AUTH_TOKEN` (pass/fail only, no user ID extraction)
- Without any token configured, endpoint is open (tools/list works, tools/call fails on missing user ID)

### Available MCP Tools
| Tool | Description |
|---|---|
| `madarbot_health` | Database and Redis health check |
| `madarbot_list_accounts` | List agent accounts linked to user |
| `madarbot_list_visible_groups` | List Telegram groups visible to agents |
| `madarbot_list_tasks` | List automation tasks for a group |
| `madarbot_get_task_configuration` | Get task configuration details |
| `madarbot_update_task_configuration` | Update task control fields (is_enabled, schedule, etc.) |
| `madarbot_get_leads` | Get lead records from a Telegram group |
| `madarbot_get_notification_config` | Get notification settings |
| `madarbot_update_notification_config` | Update notification settings |
| `madarbot_get_subscriptions` | List active subscriptions |
| `madarbot_get_analytics` | Get analytics data for an agent |

### Configuration (config.py)
```python
MCP_ENABLED: bool = False
MCP_READONLY: bool = False
MCP_AUTH_TOKEN: Optional[str] = None
```

### Enable in .env
```env
MCP_ENABLED=true
MCP_AUTH_TOKEN=your-secret-token
```

### MCP Token Management
- API endpoints: `bot/dashboard/api/mcp_tokens_router.py`
- Tokens stored in `mcp_tokens` table with `tg_user_id`, `is_active`
- Create tokens via dashboard API or direct DB insert

## Operational Notes
- Redis is required
- PostgreSQL is required
- Telethon sessions must remain persistent
- Agents should automatically reconnect on disconnect
- Docker restart policy should remain enabled
- MCP tools use contextvars for per-request user ID propagation
- All MCP tools resolve actor user from DB token (no service-layer changes needed)

## Logging Requirements
Agents should log:
- session state changes
- listener startup
- group sync events
- received messages
- task execution events
- persistence failures
- retry attempts

## Deployment Checklist
- docker compose up -d
- verify Redis health
- verify Postgres health
- verify bot session connectivity
- verify lead insertion into DB
- verify automation tasks complete successfully
- verify MCP endpoint health: `curl https://madar.hamedco.com/mcp/`
