-- ============================================================
-- Admin Dashboard Migration
-- Run in Supabase SQL Editor (or via supabase db push)
-- ============================================================

-- --------------------------------------------------------
-- 1. usage_events: token & TTS tracking columns
-- --------------------------------------------------------
ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS input_tokens   INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens  INTEGER,
  ADD COLUMN IF NOT EXISTS tts_characters INTEGER;

-- --------------------------------------------------------
-- 2. payment_events: extracted revenue amount
-- --------------------------------------------------------
ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS amount_cents INTEGER;

-- --------------------------------------------------------
-- 3. profiles: per-user quota override
-- --------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS monthly_cap_override INTEGER;

-- --------------------------------------------------------
-- 4. View: admin_daily_usage
--    Usage per day / tier / endpoint with token aggregates
-- --------------------------------------------------------
CREATE OR REPLACE VIEW admin_daily_usage AS
SELECT
  date_trunc('day', ue.created_at)::date AS day,
  p.account_type_id                      AS tier,
  ue.endpoint,
  COUNT(DISTINCT ue.user_id)             AS unique_users,
  COUNT(*)                               AS requests,
  COALESCE(SUM(ue.input_tokens), 0)      AS input_tokens,
  COALESCE(SUM(ue.output_tokens), 0)     AS output_tokens,
  COALESCE(SUM(ue.tts_characters), 0)    AS tts_chars
FROM usage_events ue
JOIN profiles p ON p.id = ue.user_id
GROUP BY 1, 2, 3;

-- --------------------------------------------------------
-- 5. View: admin_revenue_summary
--    Revenue per month / tier from payment events
-- --------------------------------------------------------
CREATE OR REPLACE VIEW admin_revenue_summary AS
SELECT
  date_trunc('month', created_at)::date     AS month,
  account_type_id                           AS tier,
  event_type,
  COUNT(*)                                  AS events,
  COALESCE(SUM(amount_cents), 0)            AS total_cents
FROM payment_events
WHERE event_type IN ('purchased', 'renewed')
GROUP BY 1, 2, 3;

-- --------------------------------------------------------
-- 6. View: admin_user_list
--    Profile-level user summary for the admin user list
-- --------------------------------------------------------
DROP VIEW IF EXISTS public.admin_user_list;

CREATE OR REPLACE VIEW admin_user_list AS
SELECT
  p.id,
  p.account_type_id                                   AS tier,
  COALESCE(p.monthly_message_count, 0)                AS messages_this_month,
  p.monthly_cap_override,
  p.monthly_reset_at,
  MAX(ue.created_at)                                  AS last_active_at,
  COUNT(ue.id)                                        AS total_events
FROM profiles p
LEFT JOIN usage_events ue ON ue.user_id = p.id
GROUP BY
  p.id,
  p.account_type_id,
  p.monthly_message_count,
  p.monthly_cap_override,
  p.monthly_reset_at;
