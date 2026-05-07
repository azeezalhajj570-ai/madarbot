-- ========================================================================
-- Madarbot SaaS Database Redesign — SQL Reference
-- ========================================================================
-- This file contains practical SQL queries for:
--  - Entitlement enforcement (e.g. "Business plan = 3 linked accounts")
--  - Data access patterns
--  - Migration helpers
-- ========================================================================


-- ========================================================================
-- 1. ENTITLEMENT ENFORCEMENT: "Business plan allows 3 linked accounts"
-- ========================================================================

-- Query A: Get the max_linked_accounts entitlement for a tenant
SELECT e.key, e.value::integer AS limit_value
FROM entitlements e
JOIN subscriptions s ON s.id = e.subscription_id
WHERE s.tenant_id = :tenant_id
  AND s.status = 'active'
  AND e.key = 'max_linked_accounts';

-- Query B: Count active linked accounts for a tenant
SELECT COUNT(*) AS active_count
FROM linked_accounts
WHERE tenant_id = :tenant_id
  AND status = 'active';

-- Query C: Check if linking a 4th account would exceed the limit
-- (run before creating a new LinkedAccount)
SELECT
    (SELECT COALESCE(value::integer, 0)
     FROM entitlements e
     JOIN subscriptions s ON s.id = e.subscription_id
     WHERE s.tenant_id = :tenant_id AND s.status = 'active'
       AND e.key = 'max_linked_accounts'
    ) AS limit_value,
    (SELECT COUNT(*) FROM linked_accounts
     WHERE tenant_id = :tenant_id AND status = 'active'
    ) AS current_count,
    (SELECT COUNT(*) FROM linked_accounts
     WHERE tenant_id = :tenant_id AND status = 'active'
    ) >= COALESCE((
       SELECT value::integer FROM entitlements e
       JOIN subscriptions s ON s.id = e.subscription_id
       WHERE s.tenant_id = :tenant_id AND s.status = 'active'
         AND e.key = 'max_linked_accounts'
    ), 0) AS would_exceed_limit;


-- ========================================================================
-- 2. ASSIGN GROUPS TO LINKED ACCOUNTS
-- ========================================================================

-- Assign a group to a linked account with a specific role
INSERT INTO linked_account_groups (linked_account_id, group_id, role)
VALUES (:linked_account_id, :group_id, 'primary')
ON CONFLICT (linked_account_id, group_id)
DO UPDATE SET role = EXCLUDED.role, updated_at = NOW();

-- List all groups for a tenant's linked accounts
SELECT la.id AS linked_account_id, la.display_name, la.external_account_id,
       g.id AS group_id, g.title AS group_title, g.tg_group_id,
       lag.role, lag.is_active
FROM linked_accounts la
JOIN linked_account_groups lag ON lag.linked_account_id = la.id
JOIN groups g ON g.id = lag.group_id
WHERE la.tenant_id = :tenant_id
ORDER BY la.id, g.title;


-- ========================================================================
-- 3. SCHEDULE A TASK FOR A LINKED ACCOUNT AND GROUP
-- ========================================================================

-- Create a new task
INSERT INTO tasks_v2 (
    tenant_id, linked_account_id, assignment_id, task_key,
    display_name, executor_type, schedule_type, config, enabled
)
VALUES (
    :tenant_id, :linked_account_id, :assignment_id, 'scrape_members',
    'Scrape members from group', 'linked_account', 'cron',
    '{"batch_size": 200, "delay_seconds": 3}'::jsonb,
    true
)
RETURNING id;

-- Link the task to a group
INSERT INTO task_groups_v2 (task_id, group_id)
VALUES (:task_id, :group_id);

-- Record a task execution
INSERT INTO task_runs (task_id, tenant_id, linked_account_id, group_id, status, started_at)
VALUES (:task_id, :tenant_id, :linked_account_id, :group_id, 'running', NOW());

-- Update task run completion
UPDATE task_runs
SET status = 'completed', completed_at = NOW(),
    result_json = '{"members_scraped": 150}'::jsonb,
    duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
WHERE id = :run_id;

-- Update task statistics
UPDATE tasks_v2
SET run_count = run_count + 1, last_run_at = NOW()
WHERE id = :task_id;


-- ========================================================================
-- 4. COMPLETE ENTITLEMENTS SET FOR A PLAN
-- ========================================================================

-- Seed entitlements for the Business plan after creating a subscription
INSERT INTO entitlements (subscription_id, key, value)
SELECT :subscription_id, k, v
FROM (VALUES
    ('max_linked_accounts', '3'),
    ('max_groups_per_account', '50'),
    ('max_daily_tasks', '1000'),
    ('max_concurrent_tasks', '5'),
    ('can_scrape_members', 'true'),
    ('can_scrape_messages', 'true'),
    ('can_auto_moderate', 'true'),
    ('can_use_ai_faq', 'true'),
    ('can_broadcast_messages', 'true'),
    ('can_export_data', 'true'),
    ('max_audit_log_days', '90'),
    ('support_level', 'email')
) AS t(k, v);

-- Starter plan entitlements (for comparison)
-- max_linked_accounts=1, max_groups_per_account=5, max_daily_tasks=100,
-- can_scrape_members=false, can_auto_moderate=false, can_use_ai_faq=false

-- Enterprise plan example
-- max_linked_accounts=999, max_groups_per_account=9999, max_daily_tasks=100000


-- ========================================================================
-- 5. CHECK ALL ENTITLEMENTS AT ONCE (runtime enforcement)
-- ========================================================================

SELECT e.key, e.value
FROM entitlements e
JOIN subscriptions s ON s.id = e.subscription_id
WHERE s.tenant_id = :tenant_id
  AND s.status = 'active'
ORDER BY e.key;


-- ========================================================================
-- 6. CREATE A SUBSCRIPTION AND LINK IT TO A TENANT
-- ========================================================================

-- Create subscription for a tenant on the Business plan
WITH tenant AS (
    SELECT id FROM tenants WHERE slug = :tenant_slug OR id = :tenant_id
),
plan AS (
    SELECT id FROM plans WHERE slug = 'business'
)
INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
SELECT tenant.id, plan.id, 'active', NOW(), NOW() + INTERVAL '1 month'
FROM tenant, plan
WHERE NOT EXISTS (
    SELECT 1 FROM subscriptions
    WHERE tenant_id = tenant.id AND status = 'active'
)
RETURNING id;


-- ========================================================================
-- 7. RECORD A PAYMENT
-- ========================================================================

INSERT INTO payments (subscription_id, tenant_id, provider, amount, currency, status, provider_reference, paid_at)
VALUES (:subscription_id, :tenant_id, 'stripe', 4900, 'USD', 'paid', 'ch_3Nxxxx', NOW());


-- ========================================================================
-- 8. AUDIT LOGGING
-- ========================================================================

INSERT INTO audit_logs (tenant_id, actor_type, actor_id, action, target_type, target_id, detail)
VALUES (
    :tenant_id, 'user', :user_id::text,
    'linked_account.created', 'linked_account', :linked_account_id::text,
    '{"provider": "telegram", "phone": "+1234567890"}'::jsonb
);

-- Query recent audit trail for a tenant
SELECT created_at, actor_type, actor_id, action, target_type, target_id, detail
FROM audit_logs
WHERE tenant_id = :tenant_id
ORDER BY created_at DESC
LIMIT 50;


-- ========================================================================
-- 9. PLAN COMPARISON (catalog query)
-- ========================================================================

SELECT p.name AS product_name, pl.name AS plan_name, pl.description,
       pp.amount, pp.currency, pp.interval
FROM products p
JOIN plans pl ON pl.product_id = p.id
JOIN plan_prices pp ON pp.plan_id = pl.id
WHERE p.is_active AND pl.is_active AND pp.is_active
ORDER BY pl.sort_order, pp.amount;


-- ========================================================================
-- 10. TENANT OVERVIEW (full context)
-- ========================================================================

SELECT
    t.id AS tenant_id, t.name, t.slug, t.is_active,
    s.status AS subscription_status, s.current_period_end,
    pl.name AS plan_name,
    COUNT(DISTINCT la.id) AS linked_account_count,
    COUNT(DISTINCT lag.group_id) AS managed_group_count,
    COUNT(DISTINCT tk.id) AS active_task_count
FROM tenants t
LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status = 'active'
LEFT JOIN plans pl ON pl.id = s.plan_id
LEFT JOIN linked_accounts la ON la.tenant_id = t.id AND la.status = 'active'
LEFT JOIN linked_account_groups lag ON lag.linked_account_id = la.id AND lag.is_active
LEFT JOIN tasks_v2 tk ON tk.tenant_id = t.id AND tk.enabled
WHERE t.id = :tenant_id
GROUP BY t.id, s.id, pl.id;


-- ========================================================================
-- 11. MIGRATION HELPERS: find groups without a tenant
-- ========================================================================

SELECT id, tg_group_id, title FROM groups WHERE tenant_id IS NULL;

-- Assign orphan groups to the default tenant
UPDATE groups
SET tenant_id = (SELECT id FROM tenants ORDER BY id LIMIT 1)
WHERE tenant_id IS NULL;


-- ========================================================================
-- 12. DATA INTEGRITY CHECKS
-- ========================================================================

-- Find linked_accounts with invalid tenant_id
SELECT la.id, la.tenant_id, la.display_name
FROM linked_accounts la
LEFT JOIN tenants t ON t.id = la.tenant_id
WHERE t.id IS NULL;

-- Find groups with invalid tenant_id
SELECT g.id, g.tenant_id, g.title
FROM groups g
LEFT JOIN tenants t ON t.id = g.tenant_id
WHERE g.tenant_id IS NOT NULL AND t.id IS NULL;


-- ========================================================================
-- 13. GENERIC TASK QUERIES (product-agnostic)
-- ========================================================================

-- Create a Madarbot scrape task
INSERT INTO tasks_v2 (
    tenant_id, product_code, trigger_source, executor_type, executor_id,
    linked_account_id, target_type, target_id,
    assignment_id, task_key, display_name,
    schedule_type, schedule_cron, config
) VALUES (
    :tenant_id, 'madarbot', 'manual', 'linked_account', NULL,
    :linked_account_id, 'group', :group_id,
    'scrape_001', 'scrape_members', 'Scrape Group Members',
    'cron', '0 3 * * *',
    '{"batch_size": 200, "include_avatars": false}'::jsonb
);

-- Create a ModBot delete ads task
INSERT INTO tasks_v2 (
    tenant_id, product_code, executor_type, target_type, target_id,
    assignment_id, task_key, display_name, config
) VALUES (
    :tenant_id, 'modbot', 'bot', 'group', :group_id,
    'mod_001', 'delete_ads', 'Auto-delete spam ads',
    '{"threshold": 0.92, "categories": ["arabic_ads", "investment_scam"]}'::jsonb
);

-- Create a ConnexaxBot send WhatsApp message task
INSERT INTO tasks_v2 (
    tenant_id, product_code, executor_type, target_type,
    channel_account_id,
    assignment_id, task_key, display_name, config
) VALUES (
    :tenant_id, 'connexaxbot', 'linked_account', 'channel',
    :channel_account_id,
    'wapp_001', 'send_whatsapp', 'Sync Evolution API messages',
    '{"auto_reply_template": "Hello {name}, how can I help?"}'::jsonb
);

-- Query all tasks for a product
SELECT * FROM tasks_v2
WHERE tenant_id = :tenant_id AND product_code = 'madarbot' AND enabled = true;

-- Query upcoming tasks
SELECT t.*, la.display_name AS executor_name
FROM tasks_v2 t
LEFT JOIN linked_accounts la ON la.id = t.linked_account_id
WHERE t.tenant_id = :tenant_id
  AND t.enabled = true
  AND t.next_run_at IS NOT NULL
ORDER BY t.next_run_at;


-- ========================================================================
-- 14. BULK MESSAGE QUERIES
-- ========================================================================

-- Create a bulk message batch
INSERT INTO bulk_message_batches (
    tenant_id, task_id, task_run_id, linked_account_id, group_id,
    message_template, total_recipients
) VALUES (
    :tenant_id, :task_id, :task_run_id, :linked_account_id, :group_id,
    'Hello {name}, check out our new offer! Reply STOP to opt out.',
    100
) RETURNING id;

-- Add recipients (skip suppressed users)
INSERT INTO bulk_message_recipients (batch_id, tg_user_id, username, full_name, rendered_message)
SELECT :batch_id, gm.tg_user_id, gm.username, gm.full_name,
       REPLACE(REPLACE(:template, '{name}', COALESCE(gm.full_name, gm.username, 'there')), '{username}', COALESCE(gm.username, ''))
FROM group_members gm
WHERE gm.group_id = :group_id
  AND NOT EXISTS (
      SELECT 1 FROM messaging_suppression_list msl
      WHERE msl.tenant_id = :tenant_id AND msl.tg_user_id = gm.tg_user_id
  );

-- Update batch progress
UPDATE bulk_message_batches
SET sent_count = sent_count + 1, status = CASE WHEN sent_count >= total_recipients - 1 THEN 'completed' ELSE 'sending' END
WHERE id = :batch_id;

-- Update individual recipient status
UPDATE bulk_message_recipients
SET status = 'sent', sent_at = NOW()
WHERE id = :recipient_id;

-- Query outstanding recipients
SELECT COUNT(*) FROM bulk_message_recipients WHERE batch_id = :batch_id AND status = 'pending';

-- Add user to suppression list
INSERT INTO messaging_suppression_list (tenant_id, tg_user_id, reason)
VALUES (:tenant_id, :tg_user_id, 'user_opt_out')
ON CONFLICT (tenant_id, tg_user_id) DO NOTHING;

-- Check if user is suppressed
SELECT 1 FROM messaging_suppression_list
WHERE tenant_id = :tenant_id AND tg_user_id = :tg_user_id;


-- ========================================================================
-- 15. ENTITLEMENT ENFORCEMENT (Updated: counts all non-disconnected accounts)
-- ========================================================================

-- Count linked accounts that count against the limit
-- (active, pending 2FA, restricted — but not disconnected/banned)
SELECT COUNT(*) AS used_count
FROM linked_accounts
WHERE tenant_id = :tenant_id
  AND status NOT IN ('disconnected', 'banned');

-- Full check with limit value
SELECT
    COALESCE(e.value::integer, 0) AS max_allowed,
    (SELECT COUNT(*) FROM linked_accounts
     WHERE tenant_id = :tenant_id AND status NOT IN ('disconnected', 'banned')
    ) AS used_count
FROM entitlements e
JOIN subscriptions s ON s.id = e.subscription_id
WHERE s.tenant_id = :tenant_id AND s.status = 'active' AND e.key = 'max_linked_accounts';
