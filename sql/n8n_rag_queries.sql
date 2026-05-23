-- =====================================================
-- N8N RAG — DATA RETRIEVAL QUERIES
-- Paste these into n8n PostgreSQL nodes directly
-- =====================================================


-- =====================================================
-- 1.  LIST GROUPS (for n8n pick-list / dropdown)
-- =====================================================
-- Returns: scraped_group_id, tg_group_id, title, group_type,
--          member_count, message_count, newest_message
-- =====================================================
SELECT
    g.id                  AS scraped_group_id,
    g.tg_group_id,
    g.title,
    g.group_type,
    g.member_count,
    COUNT(m.id)           AS message_count,
    MAX(m.message_date)   AS newest_message
FROM scraped_groups g
LEFT JOIN scraped_messages m ON m.tg_group_id = g.tg_group_id
GROUP BY g.id, g.tg_group_id
HAVING COUNT(m.id) > 0
ORDER BY message_count DESC;


-- =====================================================
-- 2.  CLEAN MESSAGES (one row = one message)
-- =====================================================
-- Use filters by uncommenting the WHERE lines you need.
-- =====================================================
SELECT
    tg_group_id,
    group_name,
    message_id,
    sender_name,
    message_text,
    message_date,
    reply_to_message_id,
    reply_to_top_id
FROM n8n_rag_messages_clean
WHERE 1=1
    -- AND tg_group_id = -1001499967735
    -- AND sender_user_id = 12345
    -- AND message_date >= '2026-05-01'
    -- AND message_date  < '2026-05-23'
ORDER BY message_date DESC
LIMIT 1000;


-- =====================================================
-- 3.  CONVERSATION THREADS (full context per thread)
-- =====================================================
-- Each row = one complete thread ready for embedding.
-- Filter by group, or get all groups.
-- =====================================================
SELECT
    tg_group_id,
    group_name,
    thread_id,
    started_at,
    last_activity,
    message_count,
    participant_count,
    thread_text
FROM n8n_rag_threads
WHERE 1=1
    -- AND tg_group_id = -1001499967735
    -- AND message_count >= 5
ORDER BY message_count DESC
LIMIT 500;


-- =====================================================
-- 4.  DAILY DIGEST (time-window chunks)
-- =====================================================
-- Best for: "what happened yesterday?" queries.
-- One row = one day for one group.
-- =====================================================
SELECT
    tg_group_id,
    group_name,
    day,
    message_count,
    active_users,
    digest_text
FROM n8n_rag_daily_digest
WHERE 1=1
    -- AND tg_group_id = -1001499967735
    -- AND day >= '2026-05-01'
    -- AND day <= '2026-05-22'
ORDER BY day DESC
LIMIT 100;


-- =====================================================
-- 5.  ALL SOURCES (knowledge + daily digests)
-- =====================================================
-- Union of distilled knowledge items and raw digests.
-- n8n loops over this and sends to embeddings API.
-- =====================================================
SELECT
    source_id,
    tg_group_id,
    source_type,   -- 'knowledge' or 'digest'
    chunk_type,    -- knowledge_type or 'YYYY-MM-DD'
    embedding_text
FROM n8n_rag_all_sources
WHERE 1=1
    -- AND tg_group_id = -1001499967735
    -- AND source_type = 'digest'
ORDER BY source_id DESC
LIMIT 500;


-- =====================================================
-- 6.  SEARCH MESSAGES (full-text search via ILIKE)
-- =====================================================
-- For keyword search across all groups or one group.
-- =====================================================
SELECT
    tg_group_id,
    group_name,
    message_id,
    sender_name,
    message_text,
    message_date
FROM n8n_rag_messages_clean
WHERE message_text ILIKE '%keyword%'
    -- AND tg_group_id = -1001499967735
ORDER BY message_date DESC
LIMIT 50;


-- =====================================================
-- 7.  COUNT STATS (for pagination / progress bars)
-- =====================================================
SELECT
    tg_group_id,
    group_name,
    COUNT(*)              AS total_messages,
    MIN(message_date)     AS oldest,
    MAX(message_date)     AS newest
FROM n8n_rag_messages_clean
WHERE 1=1
    -- AND tg_group_id = -1001499967735
GROUP BY tg_group_id, group_name;
