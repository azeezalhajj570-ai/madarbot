# MadarBot — AI Agent Operating Guide

## Branching and Git Rules

- **Never commit directly to `main`.** Always create a feature branch for changes.
- **Every branch must reference an issue.** Use naming: `feature/<issue>-<description>` or `fix/<issue>-<description>` (e.g. `feature/42-add-login`).
- Push your branch and open a pull request — direct pushes to `main` are blocked by a pre-push hook.
- Pre-push hook: `.git/hooks/pre-push` rejects pushes to `refs/heads/main`.

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

Listener reconnection: when the listener is disconnected (e.g. because an `agent_worker` job uses the same Telegram session), it removes its event handler, disconnects the client, waits, and then reconnects. The reconnect delay uses exponential backoff starting at 5s up to 60s; it resets to 5s after a stable connection of 60s or more. This prevents rapid reconnect loops and gives the worker time to finish using the session.

`lead_capture` tasks with `auto_respond: true` are sent directly by the agent listener instead of being dispatched to `agent_worker`. This avoids the worker taking over the same Telegram session and knocking the listener offline, so subsequent messages are still received.

## Groups Visibility Filter

`GET /api/agents/{id}/groups` returns groups where EITHER:
- `scraped_groups.last_agent_id == agent.id` (agent synced this group)
- `scraped_members.tg_user_id == agent.telegram_user_id` (agent is a scraped member)

This replaced the old `last_agent_id`-only filter so agents see all their groups regardless of which agent last scraped them.

## Bulk-Add Eligibility

`GET /api/agents/{id}/groups` exposes per group:
- `is_member` — the agent is a scraped member of the group.
- `is_admin` — the agent's scraped role is `admin`/`creator` (independent of eligibility).
- `can_add_members` — equals `is_member`. Any member may attempt a bulk-add.

`last_agent_id` is NOT used as a permission substitute — it only controls group
visibility and scraped-data ownership. Telegram remains the final authority:
`CHAT_ADMIN_REQUIRED` is mapped to `ERROR_NOT_ADMIN` and recorded as a
per-member failure; the group and its scraped members are never deleted or
invalidated by a failed add. See `specs/020-bulk-add-by-non-admin/spec.md`.

## Send Messages to Claimed Members

Send Messages to Group Members reuses the same member-claiming system as Bulk
Add (same `MemberClaim` table, `claim_members`/`release_claims` services, and
30-minute claim TTL). The miniapp CampaignsPage lets the user select one agent,
select members, claim them, then send messages to the members claimed by that
agent.

- `POST /api/agents/{id}/claims` — claim members for an agent (reuses
  `claim_members`; already-claimed members are conflicts, never reassigned).
- `DELETE /api/agents/{id}/claims` — release the agent's own claims.
- `POST /api/agents/{id}/claimed-send` — create a `send_to_claimed_members` job.
  Every recipient must have an active claim belonging to that agent; unclaimed
  or other-agent-claimed members are rejected with a conflict report and no job
  is created (FR-021).
- The runtime sends via the claiming agent's session, enforces the per-agent
  rate limits, records per-member results, and releases the claims in a
  `finally` block — sending never reassigns a claim (FR-009/017/020).

See `specs/021-send-messages-member-claiming/spec.md`.

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

<!-- SPECKIT START -->
## Current Plan

**Member Claiming for Send Messages to Group Members** (`021-send-messages-member-claiming`)
- Spec: `specs/021-send-messages-member-claiming/spec.md`
- Plan: `specs/021-send-messages-member-claiming/plan.md`
- Tasks: `specs/021-send-messages-member-claiming/tasks.md`

**Bulk Add by Non-Admin Group Members** (`020-bulk-add-by-non-admin`)
- Spec: `specs/020-bulk-add-by-non-admin/spec.md`
- Plan: `specs/020-bulk-add-by-non-admin/plan.md`
- Tasks: `specs/020-bulk-add-by-non-admin/tasks.md`

**Workspace-Aware Concurrent Member Claiming** (`019-workspace-member-claiming`)
- Spec: `specs/019-workspace-member-claiming/spec.md`
- Plan: `specs/019-workspace-member-claiming/plan.md`
- Tasks: `specs/019-workspace-member-claiming/tasks.md`
- Research: `specs/019-workspace-member-claiming/research.md`

**Make Miniapp Workspace-Aware** (`018-workspace-aware-miniapp`)
- Spec: `specs/018-workspace-aware-miniapp/spec.md`
- Plan: `specs/018-workspace-aware-miniapp/plan.md`
- Tasks: `specs/018-workspace-aware-miniapp/tasks.md`
- Audit: `specs/017-fix-hardcoded-group-id-fallback/audit.md`

**Workspace Member Invitations** (`016-workspace-member-invitations`)
- Spec: `specs/016-workspace-member-invitations/spec.md`
- Plan: `specs/016-workspace-member-invitations/plan.md`
- Research: `specs/016-workspace-member-invitations/research.md`
- Data Model: `specs/016-workspace-member-invitations/data-model.md`
- API Contracts: `specs/016-workspace-member-invitations/contracts/api.md`
- Quickstart: `specs/016-workspace-member-invitations/quickstart.md`
- Tasks: `specs/016-workspace-member-invitations/tasks.md`

**Multi-User Workspace MVP** (`015-workspace-mvp`)
- Spec: `specs/015-workspace-mvp/spec.md`
- Plan: `specs/015-workspace-mvp/plan.md`
- Research: `specs/015-workspace-mvp/research.md`
- Data Model: `specs/015-workspace-mvp/data-model.md`
- API Contracts: `specs/015-workspace-mvp/contracts/api.md`
- Quickstart: `specs/015-workspace-mvp/quickstart.md`
<!-- SPECKIT END -->
