# Research: Scraping Flow Investigation

**Feature**: [Scraping Flow Investigation](./spec.md)
**Date**: 2026-06-16
**Source**: Deep codebase analysis of 35+ files

## 1. Decision: Documented scraping pipeline end-to-end

**Rationale**: A complete source-to-sink map is needed before any optimization work.

**Alternatives considered**: N/A — this is a mapping exercise.

## 2. Full Scraping Pipeline

### 2.1 Entry Points

| Trigger | Source | How |
|---------|--------|-----|
| Dashboard scraper view | `index.html` L~4680 | `POST /webapp/scraper/scrape/full-group`, `/scrape/members`, `/scrape/messages` |
| Mini-app leads acquisition | `LeadsAcquisitionSection.tsx` | `agentsAPI.createAgentJob()` with `SCRAPER_FULL_GROUP` |
| Campaign scrape button | `CampaignsPage.tsx` L~237 | `agentsApi.scrapeAgentGroupMembers()` |
| Agent groups endpoint | `api/routers/agents.py` L~545 | `POST /webapp/agents/{id}/groups/{tg_id}/scrape-members` |
| Generic job creation | `api/routers/agents.py` L~662 | `POST /webapp/agents/{id}/jobs` |

### 2.2 Job Creation → Dispatch → Execution

```
UI/API → creates AgentJob(status=pending, job_type=scraper_full_group, ...)
       → dispatch_agent_job(job_id)                  [dispatch.py:59]
         → redis_broker.enqueue(Message(              [dispatch.py:68]
             queue_name="agent",
             actor_name="execute_agent_job",
             args=(agent_id, job_id)))
         → job.status = "queued"                      [dispatch.py:77]
       → Dramatiq picks up message
       → execute_agent_job(agent_id, job_id)          [worker.py:579]
         → _execute_agent_job_impl()                  [worker.py:404]
           → job.status = "running"                   [worker.py:431]
           → session_manager.get_client(agent_id)     [session.py] (Telethon)
           → ScraperRuntime().execute(client, agent, payload, job_type)
             → ScraperService(session).scrape_full_group() or scrape_members()/etc
           → _set_job_state(session, job_id, "completed", result)
           → _create_job_notification()               [worker.py:284]
       → _build_job_notification() creates notification payload
```

### 2.3 Job Type Mapping

| Constant | Value | Full Group? | Flow |
|----------|-------|-------------|------|
| `SCRAPER_GROUP_INFO_JOB_TYPE` | `scraper_group_info` | — | `scrape_group_info()` → upsert `ScrapedGroup` |
| `SCRAPER_MEMBERS_JOB_TYPE` | `scraper_members` | — | `scrape_members()` → admin fetch → iter_participants → batch upsert `ScrapedMember` |
| `SCRAPER_MESSAGES_JOB_TYPE` | `scraper_messages` | — | `scrape_messages()` or `scrape_messages_checkpointed()` → batch upsert `ScrapedMessage` + `ScrapedMember` |
| `SCRAPER_FULL_GROUP_JOB_TYPE` | `scraper_full_group` | Yes | Orchestrator: group_info + members + messages |

### 2.4 Workflow Management

| Phase | Behavior |
|-------|----------|
| Pre-flight | `scrape_full_group()` calls `scrape_group_info()` first (L~1159), then `scrape_members()` (L~1191) and optionally `scrape_messages()` (L~1221) |
| Strategy selection | `messages` job: if `limit >= 5000` → `checkpoint` strategy; otherwise `full`. `full_group` forces `checkpoint` for messages. |
| Two-period scan | `scrape_messages_two_period()`: recent days (30) first, then archive days (365) — two-pass strategy |
| Conversation building | After every message batch flush in `scrape_messages()` and `scrape_messages_checkpointed()` (L~481-486, L~715-731), called inline. Additionally enqueued as separate Dramatiq jobs post-scrape (L~719-720 in runtime.py) |
| Checkpoint/resume | `scrape_messages_checkpointed()` saves `scrape_state` JSON to `ScrapedGroup` every `_CHECKPOINT_EVERY = 10000` messages. Contains `last_scraped_message_id`, `total_success`, `total_errors`, `batches_completed`, `last_batch_at`. |

### 2.5 Checkpoint Flow

```
scrape_messages_checkpointed():
  loads ck = group.scrape_state.get("messages", {})
  offset_id = ck.get("last_scraped_message_id", 0)
  paginates via GetHistoryRequest(limit=history_page_size, offset_id=offset_id)
  every _CHECKPOINT_EVERY messages:
    group.scrape_state = {"messages": {last_scraped_message_id, total_success, ...}}
    await session.commit()       ← checkpoint persisted
  final flush → conversation_build jobs enqueued
```

## 3. Database Persistence Patterns

### 3.1 Write Methods

| Table | Method | Batch Size | Deduplication |
|-------|--------|------------|---------------|
| `scraped_groups` | Individual `session.add()` in `get_or_create_scraped_group()` | 1 per group | SELECT first by `tg_group_id` unique |
| `scraped_members` | `bulk_upsert_scraped_members()` via `INSERT ... ON CONFLICT (tg_group_id, tg_user_id) DO UPDATE` | 1800 (`_MEMBER_BATCH_SIZE`) | In-memory dedup by `(tg_group_id, tg_user_id)` before upsert |
| `scraped_messages` | `bulk_upsert_scraped_messages()` via `INSERT ... ON CONFLICT (tg_group_id, message_id) DO UPDATE` | 1800 (`_MESSAGE_BATCH_SIZE`) | In-memory dedup by `(tg_group_id, message_id)` before upsert |
| `scraped_conversations` | Individual `session.add()` or update-in-place | 1 per thread | SELECT by `(scraped_group_id, root_message_id)` |
| `scraped_daily_summaries` | Via `knowledge_extractor.py` | N/A | Unique on `(scraped_group_id, date)` |
| `group_knowledge` | Via `knowledge_extractor.py` | N/A | No unique constraint |
| `scraped_leads` | Via `agent_lead_service.py` | N/A | Deduplicable by `(group_id, tg_user_id, source_group_tg_id)` per constitution VIII |

### 3.2 Transaction Behavior

- Each scraping method opens its own `AsyncSession` (passed from `ScraperRuntime.execute()` which creates one via `SessionLocal()`)
- **No explicit transaction boundaries** — relies on SQLAlchemy's auto-commit behavior with `await session.commit()` at batch boundaries
- Error handling: `await session.rollback()` on exception, but this can lose **in-flight batch data** (uncommitted rows in `member_batch`/`message_batch` lists)
- Conversation builds: called inline within message batch processing (same session) → adds `ScrapedConversation` objects to session → committed at next batch flush

### 3.3 Index Coverage

| Table | Index | Type | Used By |
|-------|-------|------|---------|
| `scraped_groups` | `tg_group_id` UNIQUE | Lookup | `get_or_create_scraped_group()` |
| `scraped_groups` | `group_type` | Filter | Dashboard filtering |
| `scraped_groups` | `last_agent_id` FK | Join | Agent relationship |
| `scraped_members` | `(tg_group_id, tg_user_id)` UNIQUE | Upsert conflict target | `bulk_upsert_scraped_members()` |
| `scraped_members` | `tg_group_id` | Filter | Member listing by group |
| `scraped_members` | `tg_user_id` | Lookup | Member search |
| `scraped_members` | `username` | Search | Username lookup |
| `scraped_messages` | `(tg_group_id, message_id)` UNIQUE | Upsert conflict target | `bulk_upsert_scraped_messages()` |
| `scraped_messages` | `tg_group_id` | Filter | Message listing by group |
| `scraped_messages` | `sender_user_id` | Filter | Find messages by sender |
| `scraped_messages` | `message_date` | Range scan | Date filtering, pagination |
| `scraped_conversations` | `scraped_group_id` | Filter | Conversation listing |
| `scraped_conversations` | `last_message_at` | Sort | Order by recent activity |
| `scraped_leads` | `scraped_group_id` | Filter | Lead listing |
| `scraped_leads` | `status` | Filter | Status-based filtering |

## 4. Progress, Error & Retry Handling

### 4.1 Job Status Flow

```
pending → queued → running → completed
                          → failed (with _set_job_state, error stored in job_payload["last_error"])
                          → pending (flood wait reschedule with delay)
```

### 4.2 Retry Detection

- **Dramatiq retries**: `execute_agent_job` has `max_retries=3, min_backoff=5000, time_limit=86_400_000` (24h)
- `_execute_agent_job_impl()` checks `retries` from `CurrentMessage.get_current_message()` and knows `final_attempt` state
- **Flood wait reschedule**: On `AgentFloodWaitError`, job set to `pending` and re-enqueued with `delay=retry_after*1000ms`
- **Broadcast partial reschedule**: `GroupMemberBroadcastRuntime` can stop mid-broadcast on flood wait, save progress, and reschedule with computed delay

### 4.3 Error Classification

| Exception | Translation | Job Outcome |
|-----------|-------------|-------------|
| `FloodWaitError` (Telethon) | `AgentFloodWaitError(retry_after)` | `pending` + reschedule |
| `PhoneNumberBannedError` | `AgentBannedError()` | `failed` + agent marked banned |
| `UserDeactivatedBanError` | `AgentBannedError()` | `failed` + agent marked banned |
| `SessionPasswordNeededError` | `AgentSessionError` | `failed` |
| `AgentSessionRevokedError` | `AgentSessionRevokedError` | `failed` + agent marked failed |
| Generic `Exception` on final attempt | — | `failed` |
| Generic `Exception` before final attempt | — | Re-raised → Dramatiq retry |

### 4.4 Stale Job Detection

`reconcile_stale_jobs()` (`dispatch.py:29`): marks jobs in `pending`/`queued` status older than `STALE_JOB_THRESHOLD_HOURS=2` as `dispatch_stale` or `failed`.

### 4.5 Progress Reporting

- **Checkpoint state**: Stored in `ScrapedGroup.scrape_state` JSON
- **Job result**: Stored in `AgentJob.job_payload["result"]` on completion (counts: `success_count`, `member_success_count`, `messages_count`)
- **Notifications**: `_build_job_notification()` creates structured notifications with member/message counts displayed in the mini-app UI
- **No real-time progress**: No WebSocket or polling-based progress updates during scrape — only checkpoint writes to DB

## 5. Performance Analysis

### 5.1 Identified N+1 Query Patterns

#### N+1: Sender resolution in `scrape_messages()`

`extract_message_sender_data()` at `entity_resolver.py:192`:
```
For every scraped message:
  sender_obj = message.sender           # getattr (fast if cached by Telethon)
  if sender_obj is None:
    sender_obj = await message.get_sender()  # Network call to Telegram API!
```
This is a **potential N+1** — each message with an unresolved sender triggers a Telegram API call. Mitigated by Telethon caching sender objects in memory, but on first scrape or for groups where senders aren't cached, this becomes expensive.

#### N+1: `_get_existing_admin_roles()` per scrape

Called at start of `scrape_messages()` (L~418) and `scrape_messages_checkpointed()` (L~641) — one query only, not N+1. PASS.

#### N+1: Conversation update per batch

`build_conversations_from_scrape()` called inline after every batch flush: queries each conversation by `(scraped_group_id, root_message_id)` to check existence before insert/update. Each call processes a batch of message rows, so this is batch-conversation count, not message count. Acceptable.

### 5.2 Batch Insert Efficiency

| Data | Batch Size | Mechanism | Issues |
|------|-----------|-----------|--------|
| Members | 1800 | `INSERT ... ON CONFLICT DO UPDATE` | Single statement per batch — efficient |
| Messages | 1800 | `INSERT ... ON CONFLICT DO UPDATE` | Single statement per batch — efficient |
| Groups | 1 | `session.add()` | Not batched — negligible (one group per scrape) |
| Conversations | 1 per thread | `session.add()` | **Not batched** — individual inserts per conversation thread |

### 5.3 Memory Usage

- `member_batch` list: up to 1800 dicts of ~20 keys each → ~2-3 MB
- `message_batch` list: up to 1800 dicts of ~25 keys each → ~3-5 MB
- **Full message load**: `scrape_messages()` loads all messages into Telethon's iter_messages generator (streamed, not in memory)
- **Checkpoint mode**: `scrape_messages_checkpointed()` uses `GetHistoryRequest` with page size (configurable via `checkpoint_batch_size` or `scraper_history_page_size`, default 100) → very low memory
- **Conversation builder**: `build_conversations_from_scrape()` loads batch rows into dict → proportional to batch size. Standalone message grouping builds in-memory lists.
- **Member scrape**: `iter_participants()` streams, batched writes → constant memory

### 5.4 Rate Limit Handling

| Mechanism | Where | Behavior |
|-----------|-------|----------|
| Flood wait cap | `checkpointed` only (L~627, L~659) | `min(flood_wait_seconds, flood_wait_cap_seconds)` — caps wait by config |
| Batch pause | `checkpointed` only (L~626) | `scraper_history_pause_seconds` between history requests |
| Reschedule on flood | `worker.py` L~536-548 | `JobFloodWaitError` → job set `pending` → re-enqueued with delay |
| **No rate limiting**: `scrape_members()`, `scrape_messages()` (non-checkpointed) | — | No inter-request delay, no explicit flood wait handling — relies on Telethon's built-in flood control and Dramatiq retry |

### 5.5 Long-Running Session Concerns

- `_execute_agent_job_impl()`: `finally: await client.disconnect()` ensures cleanup
- Dramatiq `time_limit=86_400_000` (24h) — scrapes exceeding this fail with timeout
- No heartbeat or liveness check within scrape methods — a stuck scrape holds the worker for 24h before timeout

## 6. Optimization Opportunities (Prioritized)

### P0 — High Impact, Low Effort

1. **Add rate-limit pauses to `scrape_members()`**: Currently has no inter-request delay, risking flood waits. Add configurable `asyncio.sleep()` between `iter_participants` batches or per-N-participants.

2. **Remove duplicate sender resolution calls**: In `extract_message_sender_data()`, if `message.sender` is None but `from_id` is set, skip `await message.get_sender()` and use `from_id` directly for the user ID — the sender details are not critical for message persistence.

### P1 — High Impact, Medium Effort

3. **Batch conversation upserts**: `build_conversations_from_scrape()` does individual `session.add()` per conversation. Use bulk upsert pattern (similar to members/messages) for conversations.

4. **Add progress events**: Currently no way to know scraping progress during execution. Emit structured events (or update `AgentJob.job_payload["progress"]`) after each batch flush to enable dashboard polling.

5. **Make message sender resolution optional**: In `extract_message_sender_data()`, add a `resolve_sender: bool = True` flag. When disabled, extract only `from_id` as `sender_user_id` without the `await message.get_sender()` call. Use this in bulk message scraping where sender details are secondary.

### P2 — Medium Impact, Medium Effort

6. **Incremental scraping**: Currently `scrape_messages_checkpointed()` supports resume but always fetches ALL messages from offset. Add a `only_new` mode that checks `MAX(message_id)` from DB and only fetches newer messages.

7. **Member deduplication across runs**: `scrape_members()` always fetches admin list + all participants. Add a check: if `scraped_group.member_count` matches current count, skip re-scrape (or mark as "up-to-date").

8. **Split conversation building from message scraping**: Currently called inline during message batch flush. Move fully to the post-scrape `build_conversations_actor` queue (reduce scrape worker time).

### P3 — Lower Priority

9. **Heartbeat for long scrapes**: Add periodic `asyncio.wait_for()` or background task that updates `AgentJob.updated_at` during long scrapes to prevent stale job detection.

10. **Telethon client reuse across jobs**: Each job connects and disconnects. For high-frequency scraping, maintain a client pool with keep-alive to avoid reconnection overhead per job.

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Flood wait on large member scrape | Medium | High (job delayed) | P0: add rate limiting (already handled in checkpoint mode) |
| 24h Dramatiq timeout on very large groups | Low | High (incomplete data) | Chunking large groups into sub-jobs |
| Sender resolution N+1 saturates API | Medium | Medium | P1: make sender resolution optional |
| Checkpoint corruption on concurrent scrapes | Low | Medium | Avoid concurrent scrapes of same group |
| Stale job marking kills long-running scrape | Low | Medium | P3: heartbeat updates |
| In-memory batch loss on exception | Medium | Medium | Already handled by Dramatiq retry (replays from start or checkpoint) |
| Conversation count explosion | Medium | Low | Time-grouped groupings already split by sender; track total conversation count |
