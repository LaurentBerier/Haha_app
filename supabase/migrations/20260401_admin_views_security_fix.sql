-- ============================================================
-- Admin views hardening for Supabase linter compliance
-- - Remove SECURITY DEFINER behavior on exposed views
-- - Prevent anon/authenticated access to admin views
-- ============================================================

-- Ensure exposed admin views run with caller permissions (security invoker).
ALTER VIEW IF EXISTS public.admin_daily_usage
  SET (security_invoker = true);

ALTER VIEW IF EXISTS public.admin_revenue_summary
  SET (security_invoker = true);

ALTER VIEW IF EXISTS public.admin_user_list
  SET (security_invoker = true);

-- Lock down admin views from client roles.
REVOKE ALL ON TABLE public.admin_daily_usage FROM anon, authenticated;
REVOKE ALL ON TABLE public.admin_revenue_summary FROM anon, authenticated;
REVOKE ALL ON TABLE public.admin_user_list FROM anon, authenticated;

-- Keep backend/admin API access through service role.
GRANT SELECT ON TABLE public.admin_daily_usage TO service_role;
GRANT SELECT ON TABLE public.admin_revenue_summary TO service_role;
GRANT SELECT ON TABLE public.admin_user_list TO service_role;
