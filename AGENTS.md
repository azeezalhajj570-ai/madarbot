# MadarBot — AI Agent Operating Guide

## Repository Structure

```
├── bot/                    # Python backend
│   ├── agents/             # Agent management, jobs, runtime
│   ├── dashboard/          # FastAPI web dashboard
│   │   ├── api/            # API routers
│   │   └── frontend/       # HTML dashboard (SPA)
│   ├── db/                 # SQLAlchemy models + session
│   ├── mcp/                # MCP server + tools
│   ├── services/           # Business logic
│   │   └── scrapers/       # Telegram scraper engine
│   └── config.py           # Pydantic settings (all env vars)
├── apps/
│   └── miniapp-agents/     # React SPA for agents
│       └── src/App.tsx     # Main mini-app UI
├── packages/
│   └── miniapp-shared/     # Shared API client + types
├── infra/
│   └── nginx-madarbot.conf # Production nginx config
├── docker-compose.yml      # Main stack
├── docker-compose.dev.yml  # Dev overlays
├── docker-compose.deploy.yml # Deploy overlays
├── Dockerfile              # bot + agent_worker image
├── Dockerfile.backend      # backend image
└── .env                    # Environment variables (untracked)
```

## Building

```bash
# Build all services
docker compose build

# Build individual services
docker compose build backend
docker compose build agent_worker
docker compose build bot
docker compose build miniapp_agents
```

## Restarting

```bash
# Full restart
docker compose up -d

# Restart a single service after rebuild
docker compose build backend && docker compose up -d backend
docker compose build agent_worker && docker compose up -d agent_worker
```

## Settings (Environment Variables)

All settings are defined in `bot/config.py` using Pydantic's `BaseSettings`.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | asyncpg connection string |
| `REDIS_URL` | — | Redis connection string |
| `BOT_TOKEN` | — | Main Telegram bot token |
| `AGENTS_BOT_TOKEN` | — | Agents Telegram bot token |
| `TELEGRAM_API_ID` | — | Telegram API id |
| `TELEGRAM_API_HASH` | — | Telegram API hash |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `AI_PROVIDER` | heuristic | AI provider (openai, gemini, openrouter) |
| `AI_MODEL` | — | AI model override |
| `MCP_ENABLED` | false | Enable MCP server |
| `MCP_AUTH_TOKEN` | — | MCP bearer token |
| `DEFAULT_LANGUAGE` | en | Default UI language (ar for Arabic) |
| `DASHBOARD_BROWSER_USERS` | [] | JSON array of dashboard auth users |

## Nginx

Production nginx config: `infra/nginx-madarbot.conf`
- Domain: `madar.hamedco.com`
- Proxies to backend at `127.0.0.1:8000`
- SSL via Let's Encrypt

Miniapp internal nginx: `apps/miniapp-agents/nginx.conf`

## Database

- PostgreSQL 16 on port 5432
- Migrations via Alembic (`alembic upgrade head`)
- Models in `bot/db/models/`
- Session management in `bot/db/session.py`

## Key Data Tables

| Table | Purpose |
|-------|---------|
| `scraped_groups` | Telegram group metadata |
| `scraped_members` | Group members with roles (admin, creator, member) |
| `scraped_messages` | Scraped messages |
| `agents` | Linked Telegram accounts |
| `agent_jobs` | Async job queue |
| `scraped_leads` | Captured leads |
| `group_knowledge` | AI-extracted group knowledge |
| `mcp_tokens` | MCP API tokens |

## Common Operations

### Check if a service is healthy
```bash
docker compose ps
docker compose logs --tail=50 backend
```

### Run database migrations
```bash
docker compose run --rm migrate
# or directly:
alembic upgrade head
```

### Check migration status
```bash
alembic current
alembic heads
```

### View scraper logs
```bash
docker compose logs --tail=200 agent_worker | grep -E "admins_fetched|scrape_member|agent_job_succeeded"
```

### Rebuild and restart after code changes
```bash
docker compose build backend && docker compose up -d backend
docker compose build agent_worker && docker compose up -d agent_worker
```

### Sync admins and bots for a group (via API)
```bash
curl -X POST "https://madar.hamedco.com/webapp/agents/{agent_id}/groups/{tg_group_id}/sync-admins-bots" \
  -H "Authorization: Bearer <token>"
```

## Agent Session States

Session state is stored in Redis at `agent:{id}:state` with values: `healthy`, `flood_wait`, `banned`, `unknown`.

State transitions:
- **healthy** → session connected, listener running
- **flood_wait** → Telegram rate-limited; retry_after stored as TTL on the key; listener retries every 5s but does NOT reset the timer
- **banned** → terminal; listener stops permanently
- **failed** → auth revoked; listener stops permanently

Status endpoint: `GET /api/agents/{id}/status` returns `session_state`, `retry_after` (TTL in seconds), `flood_wait_until` (ISO timestamp).

Frontend polls every 60s and shows a colored dot + countdown in the header.

## Groups Visibility Filter

`GET /api/agents/{id}/groups` returns groups where EITHER:
- `scraped_groups.last_agent_id == agent.id` (agent synced this group)
- `scraped_members.tg_user_id == agent.telegram_user_id` (agent is a scraped member)

This replaced the old `last_agent_id`-only filter so agents see all their groups regardless of which agent last scraped them.

## Owner Dashboard Scoping

Owner endpoints (`/webapp/owner/groups`, `/webapp/owner/agents`, `/webapp/owner/stats`) now filter by the authenticated owner's groups:

```
User.tg_user_id == owner_tg_id  →  Group.owner_user_id == User.id  →  scoped results
```

Each bot owner only sees their own groups, agents, and statistics.

## Broadcast Job Status

- If `total_count > 0` and `success_count == 0` → status = `failed` (not `completed`)
- If flood wait occurs with 0 messages sent → status = `failed` (not requeued as `pending`)
- Fixes issue where jobs appeared "completed" but sent 0 messages

## MCP Server

- Endpoint: `POST /mcp/` (JSON-RPC 2.0)
- Auth: Bearer token or query param
- Enable: `MCP_ENABLED=true` in `.env`
- Tokens managed via `mcp_tokens` table
- Tools include: health, list accounts, list groups, list tasks, get leads, analytics

## Security

- Never commit `.env` files or tokens
- Use `.env.example` for placeholder values
- MCP tokens are scoped to a `tg_user_id`
- Dashboard auth via Telegram WebApp or `DASHBOARD_BROWSER_USERS`
