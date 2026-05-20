# Spec Kit: Bulk Messaging MCP Tools

## Status: Draft

---

## 1. Motivation

The bulk messaging feature lets agents send broadcast messages to Telegram group members via their linked Telegram account. It was recently expanded with admin badges, exclude-admins filter, bot exclusion, and sent-status tracking. Currently, bulk messaging is only accessible through the dashboard frontend and the Telegram bot menu — there are no MCP tools to create, monitor, or preview bulk campaigns.

## 2. Architecture

The bulk messaging system uses the **agent job** architecture:

```
MCP tool → AgentJobService.create_job() → AgentJob (pending)
                                         → Dramatiq worker picks up
                                         → GroupMemberBroadcastRuntime.execute()
                                         → Telethon client sends messages
                                         → Updates progress in job_payload
                                         → Creates notification on completion
```

### Key files

| File | Role |
|---|---|
| `bot/agents/jobs.py` | `GROUP_MEMBER_BROADCAST_JOB_TYPE` constant + `normalize_group_member_broadcast_payload()` |
| `bot/agents/agent_job_service.py` | `create_job()` — creates the job + preflight validation |
| `bot/agents/account_group_membership_service.py` | `list_scraped_agent_group_members()` — preview recipients |
| `bot/agents/runtime.py` | `GroupMemberBroadcastRuntime` — actual send loop with rate limiting |
| `bot/agents/worker.py` | Dramatiq actor that dispatches to broadcast runtime |

### Broadcast payload schema (from `normalize_group_member_broadcast_payload`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `source_group_id` | int | yes | Telegram group ID (can be negative) |
| `source_group_title` | str | no | Human-readable group name |
| `message` | str | yes | Message text (supports `{name}`, `{username}`) |
| `threshold` | int | yes | Max recipients per batch (capped at 500) |
| `interval_seconds` | float | no | Delay between sends (default 2.0) |
| `skip_bots` | bool | no | Exclude bot accounts (default true) |
| `selected_user_ids` | list[int] | no | Only send to these users (empty = all) |

### Preflight validation (in `_validate_broadcast_preflight`)

- Agent auth_state must be "active"
- Agent safety_mode must be enabled (cannot be disabled via MCP)
- Threshold (max per batch) cannot exceed 500
- Selected count cannot exceed threshold
- Cooldown, hourly limit, daily limit checked at runtime

### Progress tracking (stored in job_payload.progress)

| Field | Type | Notes |
|---|---|---|
| `total_count` | int | Total recipients in group |
| `success_count` | int | Successfully sent |
| `failure_count` | int | Failed sends |
| `skipped_count` | int | Already sent in prior batch |
| `sent_users` | list[int] | User IDs that received the message |
| `failures` | list[dict] | `{user_id, error}` pairs |
| `stopped_at` | int \| null | Index where batch stopped (partial) |
| `stop_reason` | str \| null | Why it stopped (cooldown, hourly_limit, daily_limit) |
| `retry_after` | int \| null | Seconds to wait before retry |

---

## 3. New Tools

### 3.1 `madarbot_list_bulk_recipients`

**Purpose:** Preview group members available for bulk messaging.

**Annotations:** `readOnlyHint=True, destructiveHint=False, openWorldHint=False`

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `agent_id` | int | yes | — | Agent whose group membership to list |
| `tg_group_id` | int | yes | — | Telegram group ID |
| `query` | str | no | None | Search by username, full name, or user ID |
| `page` | int | no | 1 | Page number (1-indexed) |
| `page_size` | int | no | 50 | Results per page (max 50) |

**Returns:**
```json
{
  "members": [
    {
      "user_id": 12345,
      "username": "john_doe",
      "full_name": "John Doe",
      "role": "member",
      "is_admin": false,
      "is_creator": false,
      "message_count": 42,
      "is_bot": false,
      "sent_by_agent": false
    }
  ],
  "total": 1000,
  "page": 1,
  "page_size": 50
}
```

**Implementation:** Delegates to `AccountGroupMembershipService.list_scraped_agent_group_members()`.

**Access control:** Verifies `actor_user_id` owns the agent.

---

### 3.2 `madarbot_send_bulk_message`

**Purpose:** Create and queue a bulk message broadcast job.

**Annotations:** `readOnlyHint=False, destructiveHint=False, openWorldHint=False`

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `agent_id` | int | yes | — | Agent to send through |
| `tg_group_id` | int | yes | — | Source group to target |
| `message` | str | yes | — | Message text (supports `{name}`, `{username}`) |
| `threshold` | int | no | 50 | Max recipients per batch (max 500) |
| `interval_seconds` | float | no | 2.0 | Delay between individual sends |
| `skip_bots` | bool | no | True | Exclude bot accounts |
| `selected_user_ids` | list[int] | no | [] | Only send to specific users |

**Returns:**
```json
{
  "job_id": 42,
  "status": "pending"
}
```

**Implementation:**
1. Check `ctx.readonly` — return error if true
2. Resolve agent ownership via `AgentService.get_agent()` + `ensure_agent_owner()`
3. Build payload dict with `source_group_id` (tg_group_id), `source_group_title`, `message`, `threshold`, `interval_seconds`, `skip_bots`, `selected_user_ids`
4. Call `AgentJobService.create_job(actor_user_id, agent_id, "group_member_broadcast", payload)`
5. Return `{job_id, status: "pending"}`

**Error cases:**
- Agent not found / not owned
- Agent not authenticated
- Message empty
- Invalid threshold
- Agent in cooldown / rate limited

---

### 3.3 `madarbot_list_bulk_jobs`

**Purpose:** List broadcast jobs for an agent.

**Annotations:** `readOnlyHint=True, destructiveHint=False, openWorldHint=False`

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `agent_id` | int | yes | — | Agent to list jobs for |
| `limit` | int | no | 20 | Max jobs to return |

**Returns:**
```json
{
  "jobs": [
    {
      "id": 42,
      "job_type": "group_member_broadcast",
      "status": "completed",
      "created_at": "2026-05-10T12:00:00+00:00",
      "updated_at": "2026-05-10T12:05:00+00:00",
      "payload": {
        "source_group_id": -1001234567890,
        "source_group_title": "My Group",
        "message": "Hello {name}!",
        "threshold": 50,
        "interval_seconds": 2.0,
        "skip_bots": true,
        "selected_user_ids": []
      },
      "progress": {
        "total_count": 200,
        "success_count": 50,
        "failure_count": 0,
        "skipped_count": 0,
        "sent_users": [111, 222, 333]
      }
    }
  ],
  "total": 1
}
```

**Implementation:** Calls `AgentJobService.list_agent_jobs(actor_user_id, agent_id, limit)` and filters to `group_member_broadcast` type. Extracts progress from `job_payload`.

---

### 3.4 `madarbot_get_bulk_job`

**Purpose:** Get detailed status of a single broadcast job.

**Annotations:** `readOnlyHint=True, destructiveHint=False, openWorldHint=False`

**Parameters:**

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `job_id` | int | yes | — | Job ID |

**Returns:** Same schema as a single job from `madarbot_list_bulk_jobs`.

**Implementation:** Direct DB query on `AgentJob` with ownership check against the linked agent.

---

## 4. File Changes

### New file: `bot/mcp/tools/bulk_messaging.py`

Standard MCP tool module following the existing pattern:

- Imports: `FastMCP`, `ToolAnnotations`, `SessionLocal`, `resolve_mcp_context`, `AgentJobService`, `AccountGroupMembershipService`, `GROUP_MEMBER_BROADCAST_JOB_TYPE`
- Exports: `register_bulk_messaging_tools(server: FastMCP) -> None`
- 4 inner async functions decorated with `@server.tool()`

### Modified file: `bot/mcp/server.py`

Add 2 lines:
```python
from bot.mcp.tools.bulk_messaging import register_bulk_messaging_tools
# ... in create_mcp_server():
register_bulk_messaging_tools(server)
```

### No other files changed

No new DB models, no new services, no new API endpoints. All tools delegate to existing services.

---

## 5. Existing Pattern Reference

Every MCP tool follows this shape:

```python
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

def register_*_tools(server: FastMCP) -> None:
    @server.tool(
        annotations=ToolAnnotations(readOnlyHint=..., destructiveHint=..., openWorldHint=False)
    )
    async def madarbot_*(...) -> dict:
        ctx = resolve_mcp_context()
        if ctx.readonly:
            return {"error": "Write operations are disabled (MCP_READONLY=true)"}
        async with SessionLocal() as session:
            service = SomeService(session)
            try:
                result = await service.some_method(actor_user_id=ctx.actor_user_id, ...)
                return {"key": result}
            except (ValueError, PermissionError) as e:
                return {"error": str(e)}
```

---

## 6. Acceptance Criteria

1. `madarbot_list_bulk_recipients` returns paginated member list with `sent_by_agent` flag
2. `madarbot_send_bulk_message` creates a pending `AgentJob` with `group_member_broadcast` type
3. `madarbot_list_bulk_jobs` returns broadcast jobs for an agent
4. `madarbot_get_bulk_job` returns a single job with progress
5. All tools respect `MCP_READONLY=false` for the send operation
6. All tools verify agent ownership via `actor_user_id`
7. `tools/list` shows all 4 new tools
8. Existing `test_mcp.py` tests still pass
