-- =====================================================
-- N8N RAG TABLES + VIEWS
-- Prefix: n8n_rag_
-- Source tables: scraped_groups, scraped_messages
-- =====================================================


-- =====================================================
-- Enable pgvector (once per database)
-- =====================================================
CREATE EXTENSION IF NOT EXISTS vector;


-- =====================================================
-- KNOWLEDGE ITEMS TABLE
-- Stores extracted FAQ/requirements/deadlines/etc
-- =====================================================
CREATE TABLE IF NOT EXISTS n8n_rag_knowledge_items (
    id              BIGSERIAL       PRIMARY KEY,
    tg_group_id     BIGINT          NOT NULL,
    knowledge_type  VARCHAR(50)     NOT NULL,
    question        TEXT,
    answer          TEXT,
    summary         TEXT,
    source_thread_id BIGINT,
    confidence      NUMERIC(5,4),
    content_hash    TEXT,
    metadata        JSONB           DEFAULT '{}'::jsonb,
    created_at      TIMESTAMP       DEFAULT NOW(),
    updated_at      TIMESTAMP       DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_n8n_rag_knowledge_hash
ON n8n_rag_knowledge_items(content_hash);

CREATE INDEX IF NOT EXISTS ix_n8n_rag_knowledge_group
ON n8n_rag_knowledge_items(tg_group_id);

CREATE INDEX IF NOT EXISTS ix_n8n_rag_knowledge_type
ON n8n_rag_knowledge_items(knowledge_type);

CREATE INDEX IF NOT EXISTS ix_n8n_rag_knowledge_created
ON n8n_rag_knowledge_items(created_at);


-- =====================================================
-- KNOWLEDGE EXTRACTION AUDIT LOG
-- Tracks every AI extraction run for observability
-- =====================================================
CREATE TABLE IF NOT EXISTS n8n_rag_knowledge_log (
    id              BIGSERIAL       PRIMARY KEY,
    run_uuid        UUID            NOT NULL DEFAULT gen_random_uuid(),
    tg_group_id     BIGINT          NOT NULL,
    source_view     VARCHAR(50)     NOT NULL,
    status          VARCHAR(20)     NOT NULL DEFAULT 'running',
    items_extracted INT             DEFAULT 0,
    total_input_rows INT            DEFAULT 0,
    triggered_by    VARCHAR(255),
    error_message   TEXT,
    started_at      TIMESTAMP       DEFAULT NOW(),
    completed_at    TIMESTAMP,
    metadata        JSONB           DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_n8n_rag_log_group
ON n8n_rag_knowledge_log(tg_group_id);

CREATE INDEX IF NOT EXISTS ix_n8n_rag_log_status
ON n8n_rag_knowledge_log(status);


-- =====================================================
-- VECTOR EMBEDDINGS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS n8n_rag_embeddings (
    knowledge_id    BIGINT          PRIMARY KEY
                                    REFERENCES n8n_rag_knowledge_items(id)
                                    ON DELETE CASCADE,
    embedding       vector(1536),
    created_at      TIMESTAMP       DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_n8n_rag_embedding_vector
ON n8n_rag_embeddings
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 20);


-- =====================================================
-- PERFORMANCE INDEX FOR THREAD GROUPING
-- =====================================================
CREATE INDEX IF NOT EXISTS ix_scraped_messages_reply_top
ON scraped_messages(reply_to_top_id)
WHERE reply_to_top_id IS NOT NULL;


-- =====================================================
-- CLEAN TELEGRAM MESSAGES VIEW
-- Removes junk/noise
-- =====================================================
CREATE OR REPLACE VIEW n8n_rag_messages_clean AS
SELECT
    m.id,
    m.tg_group_id,
    g.title                   AS group_name,
    m.message_id,
    COALESCE(m.sender_username, m.sender_first_name, 'unknown')
                              AS sender_name,
    m.sender_user_id,
    m.message_text,
    m.message_date,
    m.reply_to_message_id,
    m.reply_to_top_id,
    m.message_type
FROM scraped_messages m
JOIN scraped_groups g ON g.tg_group_id = m.tg_group_id
WHERE
    m.message_text IS NOT NULL
    AND TRIM(m.message_text) != ''
    AND LENGTH(TRIM(m.message_text)) > 5
    AND LENGTH(
        REGEXP_REPLACE(TRIM(m.message_text), '[[:punct:][:space:]]', '', 'g')
    ) > 2;


-- =====================================================
-- CONVERSATION THREAD VIEW
-- =====================================================
CREATE OR REPLACE VIEW n8n_rag_threads AS
WITH thread_messages AS (
    SELECT
        COALESCE(reply_to_top_id, reply_to_message_id, message_id)
                              AS thread_id,
        tg_group_id,
        group_name,
        sender_name,
        sender_user_id,
        message_text,
        message_date
    FROM n8n_rag_messages_clean
)
SELECT
    tg_group_id,
    group_name,
    thread_id,
    MIN(message_date)         AS started_at,
    MAX(message_date)         AS last_activity,
    COUNT(*)                 AS message_count,
    COUNT(DISTINCT sender_user_id)
                              AS participant_count,
    STRING_AGG(sender_name || ': ' || message_text, E'\n---\n'
               ORDER BY message_date)
                              AS thread_text
FROM thread_messages
GROUP BY tg_group_id, group_name, thread_id
HAVING COUNT(*) >= 2;


-- =====================================================
-- DAILY DIGEST VIEW
-- Useful for "what happened yesterday?"
-- =====================================================
CREATE OR REPLACE VIEW n8n_rag_daily_digest AS
SELECT
    tg_group_id,
    group_name,
    DATE(message_date)        AS day,
    COUNT(*)                 AS message_count,
    COUNT(DISTINCT sender_user_id)
                              AS active_users,
    STRING_AGG(sender_name || ': ' || message_text, E'\n---\n'
               ORDER BY message_date)
                              AS digest_text
FROM n8n_rag_messages_clean
GROUP BY tg_group_id, group_name, DATE(message_date);


-- =====================================================
-- EMBEDDING SOURCE VIEW (distilled knowledge)
-- =====================================================
CREATE OR REPLACE VIEW n8n_rag_embedding_source AS
SELECT
    k.id,
    k.tg_group_id,
    k.knowledge_type,
    k.question,
    k.answer,
    k.summary,
    COALESCE('Question: ' || k.question, '')
        || E'\n\n'
        || COALESCE('Answer: ' || k.answer, '')
        || E'\n\n'
        || COALESCE('Summary: ' || k.summary, '')
                              AS embedding_text
FROM n8n_rag_knowledge_items k;


-- =====================================================
-- UNIFIED EMBEDDING SOURCE VIEW (knowledge + raw digests)
-- =====================================================
CREATE OR REPLACE VIEW n8n_rag_all_sources AS
SELECT
    -(k.id)                   AS source_id,
    k.tg_group_id,
    k.knowledge_type          AS source_type,
    'knowledge'               AS chunk_type,
    k.embedding_text,
    k.id                      AS knowledge_id
FROM n8n_rag_embedding_source k

UNION ALL

SELECT
    d.tg_group_id * 1000000 + EXTRACT(DOY FROM d.day)::BIGINT
                              AS source_id,
    d.tg_group_id,
    'digest'                  AS source_type,
    TO_CHAR(d.day, 'YYYY-MM-DD')
                              AS chunk_type,
    d.digest_text             AS embedding_text,
    NULL                      AS knowledge_id
FROM n8n_rag_daily_digest d
WHERE d.message_count > 5;
