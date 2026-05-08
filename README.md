# MadarBot

MadarBot is an AI-powered Telegram automation platform for group monitoring, lead capture, agent workflows, and AI-assisted replies.

## What It Does

MadarBot helps automate Telegram group operations by:

- connecting to Telegram through bot and agent sessions
- syncing Telegram groups
- listening for group messages
- detecting useful lead or support signals
- running automation tasks
- persisting captured leads
- supporting AI-assisted replies
- logging agent and task activity with structured events

## Main Use Cases

- Lead capture from Telegram groups
- Support request detection
- AI reply assistance
- Group automation workflows
- Agent-based task execution
- Telegram group monitoring

## Repository Documentation

| File | Purpose |
|---|---|
| `AGENT.md` | Main AI agent operating guide + MCP server details |
| `agents/lead_capture_agent.md` | Lead capture agent behavior and rules |
| `agents/reply_agent.md` | AI reply agent behavior and safety rules |
| `agents/system_prompt.md` | Shared system prompt guidance |
| `docs/DEVELOPMENT_WORKFLOW.md` | Coding workflow, commit rules, PR rules, and best practices |
| `docs/TESTING_STRATEGY.md` | Unit, integration, E2E, regression, DB, and smoke testing strategy |
| `docs/DEPLOYMENT_CHECKLIST.md` | Deployment, verification, and rollback checklist |
| `.env.example` | Environment variable template |

## Requirements

- Docker
- Docker Compose
- PostgreSQL
- Redis
- Telegram API credentials
- Telegram bot token or agent session credentials
- Python backend runtime used by this project

## Required Environment Variables

Copy `.env.example` to `.env` and fill in the required values.

```bash
cp .env.example .env
```

Important variables:

```env
BOT_APP_KIND=agents
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
AGENTS_BOT_TOKEN=
BOT_TOKEN=
DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/combot
REDIS_URL=redis://redis:6379/0
DEFAULT_LANGUAGE=ar
OPENAI_API_KEY=
```

Never commit `.env` or production secrets.

## Running Locally

Start services:

```bash
docker compose up -d
```

Check service status:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs --tail=200
```

For focused logs:

```bash
docker compose logs --tail=200 backend bot agent_worker
```

## Database Migrations

Check migration heads:

```bash
alembic heads
```

Check current migration:

```bash
alembic current
```

Apply migrations:

```bash
alembic upgrade head
```

## Testing

Run all tests:

```bash
pytest
```

Run a specific test file:

```bash
pytest tests/path/to/test_file.py
```

Run a single test:

```bash
pytest tests/path/to/test_file.py::test_name
```

Recommended checks before pushing:

```bash
git diff --check
pytest
```

Recommended checks when available:

```bash
ruff check .
ruff format --check .
mypy .
```

See `docs/TESTING_STRATEGY.md` for the full testing policy.

## Development Workflow

Use short-lived branches from `main`.

Branch examples:

```text
fix/lead-capture-deduplication
feat/support-agent
docs/agent-workflow
test/task-service-regression
chore/docker-healthcheck
```

Before committing:

1. Review the diff.
2. Remove debug code.
3. Confirm secrets are not included.
4. Run relevant tests.
5. Update docs when behavior changes.

Commit format:

```text
<type>: <short description>
```

Examples:

```text
fix: persist bot lead capture records
test: add task service regression tests
docs: add deployment checklist
```

See `docs/DEVELOPMENT_WORKFLOW.md` for the full workflow.

## Deployment

Before deploy:

```bash
git status --short
git log --oneline -5
pytest
docker compose config
```

Build and start:

```bash
docker compose build
docker compose up -d
```

Verify:

```bash
docker compose ps
docker compose logs --tail=200 backend bot agent_worker
```

After deployment, confirm:

- backend is healthy
- bot connects to Telegram
- agent session becomes healthy
- groups sync successfully
- lead_capture task triggers
- leads are persisted in the database
- no service is crash-looping

See `docs/DEPLOYMENT_CHECKLIST.md` for the full deployment checklist.

## AI Agent Runtime Expectations

Agents should:

- maintain healthy Telegram sessions
- listen for incoming group messages
- route messages to automation tasks
- persist valid lead capture events
- deduplicate leads safely
- log structured operational events
- retry transient failures
- avoid exposing secrets

Important structured events include:

- `agent_session_state_changed`
- `agent_listener_started`
- `agent_groups_synced`
- `agent_listener_message_seen`
- `agent_message_received_for_task`

## Lead Capture Behavior

Lead capture should persist valid leads and deduplicate by:

- `group_id`
- `tg_user_id`
- `source_group_tg_id`

Bot-originated lead capture tasks should support nullable `agent_id`.

## Redis Host Setting

Redis may warn that memory overcommit is disabled. On Linux hosts, enable it with:

```bash
sudo sysctl vm.overcommit_memory=1
echo 'vm.overcommit_memory = 1' | sudo tee /etc/sysctl.d/99-redis.conf
```

## MCP Server

MadarBot exposes an MCP (Model Context Protocol) JSON-RPC endpoint at `/mcp/` for external AI agent control when `MCP_ENABLED=true`.

### Endpoint
- `POST /mcp/` — JSON-RPC 2.0 (tools/list, tools/call, initialize)
- `GET /mcp/` — returns initialize payload (ChatGPT compatibility)

### Enabling
```env
MCP_ENABLED=true
MCP_AUTH_TOKEN=your-secret-token
```

### Authentication
- Bearer token via `Authorization: Bearer <token>` header or `?token=<token>` query param
- DB-backed tokens in `mcp_tokens` table (primary; extracts tg_user_id from token)
- Env fallback: `MCP_AUTH_TOKEN` (pass/fail only)
- Token management: `bot/dashboard/api/mcp_tokens_router.py`

### Available Tools
| Tool | Description |
|---|---|
| `madarbot_health` | Database and Redis health check |
| `madarbot_list_accounts` | List agent accounts linked to user |
| `madarbot_list_visible_groups` | List Telegram groups visible to agents |
| `madarbot_list_tasks` | List automation tasks for a group |
| `madarbot_get_task_configuration` | Get task configuration details |
| `madarbot_update_task_configuration` | Update task control fields |
| `madarbot_get_leads` | Get lead records from a Telegram group |
| `madarbot_get_notification_config` | Get notification settings |
| `madarbot_update_notification_config` | Update notification settings |
| `madarbot_get_subscriptions` | List active subscriptions |
| `madarbot_get_analytics` | Get analytics data for an agent |

### Verify
```bash
curl https://madar.hamedco.com/mcp/
curl -s "https://madar.hamedco.com/mcp/" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/list","id":1,"params":{}}'
```

### Key Files
| File | Purpose |
|---|---|
| `bot/mcp/server.py` | MCP server creation + lifecycle |
| `bot/mcp/auth.py` | DB-first token auth + env fallback |
| `bot/mcp/context.py` | Per-request user ID via contextvars |
| `bot/mcp/tools/` | Tool implementations (health, groups, tasks, leads, etc.) |
| `bot/dashboard/api/mcp_router.py` | /mcp/ JSON-RPC endpoint |
| `bot/config.py` | MCP_ENABLED, MCP_AUTH_TOKEN, MCP_READONLY |
| `tests/test_mcp.py` | MCP integration tests |

## Security Rules

Never commit:

- `.env`
- bot tokens
- API keys
- Telegram session files
- database credentials
- private keys
- production logs containing secrets

Use `.env.example` only for safe placeholder values.

## Definition of Done

A change is complete when:

- code is implemented
- tests pass
- docs are updated
- migrations are verified if needed
- deployment impact is understood
- rollback path is clear
- PR is reviewed and merged safely
