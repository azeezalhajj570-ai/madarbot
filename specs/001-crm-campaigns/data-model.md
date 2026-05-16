# Data Model: CRM-Style Campaigns

## Entities

### Campaign

Table: `campaigns`

| Column | Type | Constraints | Notes |
|--------|------|-----------|-------|
| `id` | Integer | PK, auto-increment | |
| `agent_id` | Integer | FK -> agents.id, NOT NULL, indexed | Owner of this campaign |
| `name` | String(255) | NOT NULL | Campaign display name |
| `description` | Text | nullable | Optional description |
| `type` | String(32) | NOT NULL, default `broadcast` | broadcast, announcement, promo, reminder |
| `status` | String(32) | NOT NULL, default `draft`, indexed | draft, scheduled, running, paused, completed, cancelled |
| `message_template` | Text | nullable | Message text with optional placeholders |
| `target_filters` | JSON | default `{}` | Groups, exclusions, language filters |
| `total_recipients` | Integer | NOT NULL, default `0` | |
| `sent_count` | Integer | NOT NULL, default `0` | |
| `failed_count` | Integer | NOT NULL, default `0` | |
| `skipped_count` | Integer | NOT NULL, default `0` | |
| `created_by` | BigInteger | nullable | Telegram user ID who created it |
| `scheduled_at` | DateTime(timezone) | nullable | If scheduled for future |
| `started_at` | DateTime(timezone) | nullable | When sending started |
| `completed_at` | DateTime(timezone) | nullable | When sending completed |
| `created_at` | DateTime(timezone) | NOT NULL, default now | |
| `updated_at` | DateTime(timezone) | NOT NULL, default now, onupdate | |

Relationships:
- `Campaign.agent` -> `Agent` (Many-to-One)
- `Campaign.jobs` -> `AgentJob` (One-to-Many)

### AgentJob (additions)

Add to existing `agent_jobs` table:

| Column | Type | Constraints | Notes |
|--------|------|-----------|-------|
| `campaign_id` | Integer | FK -> campaigns.id, nullable, indexed | |

New relationship:
- `AgentJob.campaign` -> `Campaign` (Many-to-One)

### SentBroadcastMessage (additions)

Add to existing `sent_broadcast_messages` table:

| Column | Type | Constraints | Notes |
|--------|------|-----------|-------|
| `campaign_id` | Integer | FK -> campaigns.id, nullable, indexed | |

## Entity-Relationship Diagram

```
Campaign
  │
  ├── has many ──► AgentJob (campaign_id FK)
  │                    │
  │                    └── has many ──► SentBroadcastMessage (agent_job_id FK)
  │
  └── has many ──► SentBroadcastMessage (campaign_id FK)
```

## Key Queries

### Cross-group dedup check:
```sql
SELECT tg_user_id FROM sent_broadcast_messages
WHERE campaign_id = :campaign_id
  AND tg_user_id = :tg_user_id
  AND message_hash = :message_hash
  AND status = 'sent'
  AND sent_at > :cutoff
```

### Campaign send-logs:
```sql
SELECT * FROM sent_broadcast_messages
WHERE campaign_id = :campaign_id
ORDER BY sent_at DESC
LIMIT :limit OFFSET :offset
```

### Campaign stats:
```sql
SELECT total_recipients, sent_count, failed_count, skipped_count
FROM campaigns WHERE id = :campaign_id
```
