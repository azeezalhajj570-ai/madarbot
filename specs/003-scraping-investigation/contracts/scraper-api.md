# API Contract: Scraper Endpoints

**Feature**: [Scraping Flow Investigation](./spec.md)
**Date**: 2026-06-16
**Base URL**: `/webapp/scraper`

All endpoints require dashboard authentication via Telegram WebApp identity (`extract_dashboard_identity`). Some also check agent access and group membership.

## POST /webapp/scraper/scrape/group-info

Create a group info scrape job.

**Request**: `ScrapeGroupInfoRequest`
```json
{"agent_id": 123, "tg_group_id": -1001234567890}
```

**Response**: `ScrapeJobResponse`
```json
{"job_id": 456, "status": "pending", "message": "Scrape job created for group info"}
```

**Job flow**: `AgentJob(job_type="scraper_group_info")` → `dispatch_agent_job()` → `ScraperService.scrape_group_info()` → upsert `ScrapedGroup`

## POST /webapp/scraper/scrape/members

Create a member scraping job.

**Request**: `ScrapeMembersRequest`
```json
{"agent_id": 123, "tg_group_id": -1001234567890, "member_limit": 1000}
```

**Job flow**: `AgentJob(job_type="scraper_members")` → `ScraperService.scrape_members()` → admin fetch → `iter_participants()` → bulk upsert `ScrapedMember`

## POST /webapp/scraper/scrape/messages

Create a message scraping job.

**Request**: `ScrapeMessagesRequest`
```json
{"agent_id": 123, "tg_group_id": -1001234567890, "message_limit": 100, "max_age_days": null, "scan_strategy": "auto"}
```

**Strategy selection**:
- `"auto"` → `message_limit >= 5000` → `"checkpoint"`, else `"full"`
- `"checkpoint"` → `scrape_messages_checkpointed()` with pagination, checkpoint state, flood wait handling
- `"full"` → `scrape_messages()` with `iter_messages()`, single-pass

## POST /webapp/scraper/scrape/full-group

Create a combined group info + members + messages scrape job.

**Request**: `ScrapeFullGroupRequest`
```json
{"agent_id": 123, "tg_group_id": -1001234567890, "scrape_members": true, "scrape_messages": true, "member_limit": 1000, "message_limit": 100, "max_age_days": null, "scan_strategy": "auto"}
```

**Job flow**: `AgentJob(job_type="scraper_full_group")` → `ScraperService.scrape_full_group()` → group_info → (optionally) members → (optionally) messages

## GET /webapp/scraper/groups

List scraped groups accessible to the authenticated user.

**Query params**: `group_id` (filter by specific group), `search` (text search on title)

**Response**:
```json
[{"id": 1, "tg_group_id": -100123, "title": "My Group", "username": "mygroup", "group_type": "supergroup", "member_count": 500, "description": "...", "created_at": "...", "updated_at": "..."}]
```

## GET /webapp/scraper/groups/{id}

Get details of one scraped group by DB `id`.

## GET /webapp/scraper/groups/{id}/members

Paginated member list.

**Query params**: `page`, `page_size`, `sort_by`, `sort_order`, `role`, `search`, `is_bot`

## GET /webapp/scraper/groups/{id}/messages

Paginated message list.

**Query params**: `page`, `page_size`, `sort_by`, `sort_order`, `search`, `message_type`, `date_from`, `date_to`, `sender_user_id`

## GET /webapp/scraper/groups/{id}/monthly-stats

Monthly message count aggregation.

## GET /webapp/scraper/groups/{id}/conversations

List conversation threads.

**Query params**: `page`, `page_size`, `sort_by` (default: `last_message_at`), `sort_order`

## GET /webapp/scraper/groups/{id}/conversations/{conv_id}/messages

Messages within a conversation.

**Query params**: `page`, `page_size`

## POST /webapp/scraper/groups/{id}/extract-knowledge

Trigger AI knowledge extraction. No request body.

## GET /webapp/scraper/groups/{id}/knowledge

List extracted knowledge items.

**Query params**: `knowledge_type`, `page`, `page_size`

## GET /webapp/scraper/groups/{id}/daily-summaries

List AI-generated daily summaries.

**Query params**: `date_from`, `date_to`, `page`, `page_size`

## GET /webapp/scraper/groups/{id}/search

Full-text search across messages.

**Query params**: `q` (required), `sender_user_id`, `date_from`, `date_to`, `page`, `page_size`

## GET /webapp/scraper/groups/{id}/export

Export group data as JSON or CSV.

**Query params**: `format` (`json` or `csv`)

## GET /webapp/scraper/groups/{id}/leaderboard

Top members by message count.

**Query params**: `limit` (default 20), `sort_by`

## POST /webapp/scraper/groups/{id}/extract-leads

Trigger lead extraction from messages. No request body.

## GET /webapp/scraper/groups/{id}/leads

Paginated lead listing.

**Query params**: `status`, `signal`, `page`, `page_size`, `sort_by`, `sort_order`

## PATCH /webapp/scraper/groups/{id}/leads/{lead_id}

Update lead status/notes.

**Request**:
```json
{"status": "contacted", "notes": "Contacted via DM"}
```

## GET /webapp/scraper/groups/{id}/nudges

Engagement nudge suggestions.

**Query params**: `page`, `page_size`

## Job Response Schema (WebSocket/Webhook alternative)

Jobs are currently polled via `GET /webapp/agents/{id}/jobs`. The response format:

```json
{
  "id": 456,
  "agent_id": 123,
  "job_type": "scraper_full_group",
  "status": "completed",
  "job_payload": {
    "tg_group_id": -100123,
    "result": {
      "group_info": {"title": "My Group", "member_count": 500},
      "success_count": 482,
      "member_success_count": 12,
      "messages_count": 950,
      "error_count": 0,
      "total_scraped": 482
    }
  },
  "scheduled_at": null,
  "created_at": "2026-06-16T10:00:00Z",
  "updated_at": "2026-06-16T10:05:00Z"
}
```

## Notification Contract

On job completion/failure, the worker creates `AgentNotification` records via `AgentNotificationService`. Notification `kind` values for scraper jobs:

| Kind | When | Body Format |
|------|------|-------------|
| `scrape_completed` | Job completed | `"{group_title}: {members_count} members synced and {messages_count} messages scraped. — {timestamp}"` |
| `scrape_failed` | Job failed | `"{group_title}: {error_message}"` |
| `task_completed` | Automation task | `"{task_label} executed for {group_title}."` |
| `task_failed` | Automation task failed | `"{error_message}"` |
