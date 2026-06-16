# Data Model: Scraping Domain

**Feature**: [Scraping Flow Investigation](./spec.md)
**Date**: 2026-06-16

## Entity Relationship Overview

```
scraped_groups (1) ──< scraped_members (N)     [fg: scraped_group_id]
scraped_groups (1) ──< scraped_messages (N)    [fg: scraped_group_id]
scraped_groups (1) ──< scraped_conversations (N) [fg: scraped_group_id]
scraped_groups (1) ──< scraped_daily_summaries (N) [fg: scraped_group_id]
scraped_groups (1) ──< group_knowledge (N)     [fg: scraped_group_id]
scraped_groups (1) ──< scraped_leads (N)       [fg: scraped_group_id]
agents (1) ──< agent_jobs (N)                  [fg: agent_id]
agents (1) ──< scraped_groups (N)              [fg: last_agent_id, nullable SET NULL]
```

## Entity Details

### ScrapedGroup (`scraped_groups`)

| Column | Type | Index | Nullable | Notes |
|--------|------|-------|----------|-------|
| `id` | `INTEGER PK` | — | No | Auto-increment |
| `tg_group_id` | `BIGINT` | UNIQUE | No | Canonical Telegram group ID (negative for supergroups) |
| `last_agent_id` | `INT FK→agents.id` | Yes | Yes | Last agent that scraped this group (SET NULL on delete) |
| `title` | `VARCHAR(255)` | — | Yes | Group/channel display name |
| `username` | `VARCHAR(255)` | — | Yes | Public username (@handle) |
| `group_type` | `VARCHAR(32)` | Yes | No | `group`, `channel`, `supergroup` |
| `member_count` | `INTEGER` | — | Yes | Snapshot of participant count at last scrape |
| `description` | `TEXT` | — | Yes | Group about/description |
| `raw_data` | `JSON` | — | No | Telethon entity data (`id`, `access_hash`) |
| `scrape_state` | `JSON` | — | Yes | Checkpoint state for resumable message scraping |
| `created_at` | `DATETIME(TZ)` | — | No | |
| `updated_at` | `DATETIME(TZ)` | — | No | Auto-updated on write |

**Upsert strategy**: SELECT by `tg_group_id` (UNIQUE), then create or update fields. No bulk upsert.

**Checkpoint format** (`scrape_state`):
```json
{
  "messages": {
    "last_scraped_message_id": 12345,
    "total_success": 50000,
    "total_errors": 3,
    "batches_completed": 50,
    "last_batch_at": "2026-06-16T10:00:00Z"
  }
}
```

### ScrapedMember (`scraped_members`)

| Column | Type | Index | Nullable | Notes |
|--------|------|-------|----------|-------|
| `id` | `INTEGER PK` | — | No | |
| `scraped_group_id` | `INT FK→scraped_groups.id` | Yes | No | CASCADE on delete |
| `tg_group_id` | `BIGINT` | Yes | No | Denormalized group ID for bulk queries |
| `tg_user_id` | `BIGINT` | Yes | No | Part of UNIQUE compound index |
| `username` | `VARCHAR(255)` | Yes | Yes | |
| `first_name` | `VARCHAR(255)` | — | Yes | |
| `last_name` | `VARCHAR(255)` | — | Yes | |
| `full_name` | `VARCHAR(255)` | — | Yes | |
| `phone` | `VARCHAR(32)` | — | Yes | |
| `is_bot` | `BOOLEAN` | Yes | No | |
| `is_premium` | `BOOLEAN` | — | No | |
| `role` | `VARCHAR(32)` | — | Yes | `creator`, `admin`, `member`, `restricted` |
| `joined_date` | `DATETIME(TZ)` | — | Yes | |
| `raw_data` | `JSON` | — | No | Full participant data |
| `scraped_at` | `DATETIME(TZ)` | — | No | Timestamp of last scrape |

**UNIQUE**: `(tg_group_id, tg_user_id)` — upsert conflict target.
**Upsert strategy**: `INSERT ... ON CONFLICT (tg_group_id, tg_user_id) DO UPDATE SET` (all fields except PK). Batch size: 1800.

**Role assignment flow**:
1. `scrape_members()`: Fetches admins first via `GetParticipantsRequest(ChannelParticipantsAdmins())`, assigns role from participant object
2. `scrape_messages()`: Uses `_get_existing_admin_roles()` to look up previously stored admin/creator roles from DB; fallback to `"member"`
3. `build_member_row_from_sender()`: Defaults role to `"member"` unless overridden

### ScrapedMessage (`scraped_messages`)

| Column | Type | Index | Nullable | Notes |
|--------|------|-------|----------|-------|
| `id` | `INTEGER PK` | — | No | |
| `scraped_group_id` | `INT FK→scraped_groups.id` | Yes | No | CASCADE on delete |
| `tg_group_id` | `BIGINT` | Yes | No | Denormalized |
| `message_id` | `BIGINT` | Yes | No | Telegram message ID (unique only within group) |
| `sender_user_id` | `BIGINT` | Yes | Yes | |
| `sender_username` | `VARCHAR(255)` | — | Yes | |
| `sender_first_name` | `VARCHAR(255)` | — | Yes | |
| `sender_last_name` | `VARCHAR(255)` | — | Yes | |
| `message_text` | `TEXT` | — | Yes | |
| `message_date` | `DATETIME(TZ)` | Yes | Yes | Message timestamp |
| `message_type` | `VARCHAR(32)` | Yes | No | `text`, `photo`, `video`, `document`, etc. |
| `media_file_id` | `VARCHAR(512)` | — | Yes | |
| `media_url` | `VARCHAR(1024)` | — | Yes | |
| `reply_to_message_id` | `BIGINT` | — | Yes | Thread reply |
| `reply_to_top_id` | `BIGINT` | — | Yes | Forum topic ID |
| `forward_from_user_id` | `BIGINT` | — | Yes | |
| `raw_data` | `JSON` | — | No | Full message data |
| `scraped_at` | `DATETIME(TZ)` | — | No | |

**UNIQUE**: `(tg_group_id, message_id)` — upsert conflict target.
**Upsert strategy**: `INSERT ... ON CONFLICT (tg_group_id, message_id) DO UPDATE SET` (all fields except PK). Batch size: 1800.

**Date filtering**: Applied in application code (not SQL) during message iteration — `min_message_date` check per message against `max_age_days` parameter.

### ScrapedConversation (`scraped_conversations`)

| Column | Type | Index | Nullable | Notes |
|--------|------|-------|----------|-------|
| `id` | `INTEGER PK` | — | No | |
| `scraped_group_id` | `INT FK→scraped_groups.id` | Yes | No | CASCADE on delete |
| `tg_group_id` | `BIGINT` | — | No | |
| `root_message_id` | `BIGINT` | — | Yes | Message that started thread |
| `root_message_text` | `TEXT` | — | Yes | |
| `root_sender_user_id` | `BIGINT` | — | Yes | |
| `root_sender_name` | `VARCHAR(255)` | — | Yes | |
| `title` | `VARCHAR(500)` | — | Yes | First 200 chars of root message |
| `participant_count` | `INTEGER` | — | No | |
| `message_count` | `INTEGER` | — | No | |
| `first_message_at` | `DATETIME(TZ)` | — | Yes | |
| `last_message_at` | `DATETIME(TZ)` | Yes | Yes | For sort-by-recent |
| `is_topic` | `BOOLEAN` | — | No | Forum topic threads |
| `created_at` | `DATETIME(TZ)` | — | No | |
| `updated_at` | `DATETIME(TZ)` | — | No | Auto-updated |

**No unique constraint** — conversations with same root_message_id are updated in-place. **No bulk upsert** — each conversation is individually `session.add()` or updated.

**Build strategy**:
1. **Reply threads**: Messages with `reply_to_message_id` or `reply_to_top_id` are grouped by that key
2. **Time groups**: Standalone messages (no reply) are grouped by same-sender within `CONVERSATION_IDLE_MINUTES = 30` window
3. Can be called inline during message scraping or as separate Dramatiq actor jobs

### ScrapedDailySummary (`scraped_daily_summaries`)

| Column | Type | Index | Nullable |
|--------|------|-------|----------|
| `id` | `INTEGER PK` | — | No |
| `scraped_group_id` | `INT FK→scraped_groups.id` | Yes | No |
| `date` | `DATETIME(TZ)` | UNIQUE with group | No |
| `message_count` | `INTEGER` | — | No |
| `active_users` | `JSON` | — | Yes |
| `top_topics` | `JSON` | — | Yes |
| `summary` | `TEXT` | — | Yes |
| `created_at` | `DATETIME(TZ)` | — | No |

UNIQUE: `(scraped_group_id, date)`. AI-generated via `KnowledgeExtractor`.

### GroupKnowledge (`group_knowledge`)

| Column | Type | Index | Nullable |
|--------|------|-------|----------|
| `id` | `INTEGER PK` | — | No |
| `scraped_group_id` | `INT FK→scraped_groups.id` | Yes | No |
| `knowledge_type` | `VARCHAR(32)` | Yes | No |
| `title` | `VARCHAR(500)` | — | Yes |
| `content` | `TEXT` | — | Yes |
| `source_message_ids` | `JSON` | — | Yes |
| `confidence` | `FLOAT` | — | No |
| `metadata` | `JSON` | — | Yes |
| `first_seen` | `DATETIME(TZ)` | — | Yes |
| `last_updated` | `DATETIME(TZ)` | — | Yes |
| `created_at` | `DATETIME(TZ)` | — | No |

Types: `faq`, `topic`, `entity`, `decision`, `trend`, `consensus`. No unique constraint.

### ScrapedLead (`scraped_leads`)

| Column | Type | Index | Nullable |
|--------|------|-------|----------|
| `id` | `INTEGER PK` | — | No |
| `scraped_group_id` | `INT FK→scraped_groups.id` | Yes | No |
| `source_message_id` | `BIGINT` | — | Yes |
| `sender_user_id` | `BIGINT` | — | Yes |
| `sender_name` | `VARCHAR(255)` | — | Yes |
| `signal` | `VARCHAR(64)` | — | Yes |
| `excerpt` | `TEXT` | — | Yes |
| `contact_info` | `VARCHAR(512)` | — | Yes |
| `status` | `VARCHAR(32)` | Yes | No |
| `confidence` | `FLOAT` | — | No |
| `notes` | `TEXT` | — | Yes |
| `detected_at` | `DATETIME(TZ)` | — | No |
| `created_at` | `DATETIME(TZ)` | — | No |

Signal types: `buying_intent`, `contact_request`, `support_need`, `hiring`, `partnership`. Status: `new`, `contacted`, `converted`, `dismissed`. Deduplication key per constitution VIII: `(group_id, tg_user_id, source_group_tg_id)`.

### AgentJob (`agent_jobs`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `INTEGER PK` | |
| `agent_id` | `INT FK→agents.id` | |
| `job_type` | `VARCHAR(64)` | `scraper_group_info`, `scraper_members`, `scraper_messages`, `scraper_full_group`, `group_member_broadcast`, `add_contact`, `send_lead_message`, `automation_task` |
| `status` | `VARCHAR(32)` | `pending`, `queued`, `running`, `completed`, `failed`, `aborted`, `scheduled`, `enqueue_failed`, `dispatch_stale` |
| `job_payload` | `JSON` | Params + `result` dict + `last_error` + `progress` (for broadcasts) |
| `campaign_id` | `INT FK` | Optional campaign association |
| `created_at` | `DATETIME(TZ)` | |
| `updated_at` | `DATETIME(TZ)` | Updated on status changes |
| `scheduled_at` | `DATETIME(TZ)` | Optional scheduled execution time |

## Write Pattern Summary

| Table | Pattern | Batch | Dedup Key | Transaction |
|-------|---------|-------|-----------|-------------|
| `scraped_groups` | Individual upsert | 1 | `tg_group_id` | Manual commit |
| `scraped_members` | Bulk upsert | 1800 | `(tg_group_id, tg_user_id)` | Executed within shared session |
| `scraped_messages` | Bulk upsert | 1800 | `(tg_group_id, message_id)` | Executed within shared session |
| `scraped_conversations` | Individual add/update | 1 | `(scraped_group_id, root_message_id)` | Part of batch flush |
| `scraped_daily_summaries` | Individual upsert | 1 | `(scraped_group_id, date)` | Separate session |
| `group_knowledge` | Individual insert | 1 | None | Separate session |
| `scraped_leads` | Individual insert | 1 | None | Separate session |
| `agent_jobs` | Individual update | 1 | `id` PK | Manual commit in worker |

## Key Constraints & Relationships

- `scraped_groups.tg_group_id` UNIQUE — ensures one row per Telegram group
- `scraped_members (tg_group_id, tg_user_id)` UNIQUE — one membership record per user per group
- `scraped_messages (tg_group_id, message_id)` UNIQUE — one record per message per group
- All child tables have `FK → scraped_groups.id ON DELETE CASCADE`
- `scraped_groups.last_agent_id` → `agents.id ON DELETE SET NULL`
