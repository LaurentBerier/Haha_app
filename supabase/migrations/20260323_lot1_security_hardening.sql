-- ============================================================
-- Lot 1 security/correctness hardening
-- - Account deletion RPC (transactional cleanup + audit)
-- - Admin user list view enrichment (email/auth_created_at/id_text)
-- ============================================================

create or replace function public.delete_account_cascade(
  p_user_id uuid,
  p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  -- Optional app tables (defensive: only delete when table/column exist).
  if to_regclass('public.messages') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'user_id'
    ) then
      execute 'delete from public.messages where user_id = $1' using p_user_id;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'conversation_id'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversations' and column_name = 'id'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversations' and column_name = 'user_id'
    ) then
      execute
        'delete from public.messages m using public.conversations c where m.conversation_id = c.id and c.user_id = $1'
      using p_user_id;
    end if;
  end if;

  if to_regclass('public.conversations') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversations' and column_name = 'user_id'
  ) then
    execute 'delete from public.conversations where user_id = $1' using p_user_id;
  end if;

  if to_regclass('public.usage_events') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'usage_events' and column_name = 'user_id'
  ) then
    execute 'delete from public.usage_events where user_id = $1' using p_user_id;
  end if;

  if to_regclass('public.payment_events') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_events' and column_name = 'user_id'
  ) then
    execute 'delete from public.payment_events where user_id = $1' using p_user_id;
  end if;

  if to_regclass('public.stripe_customer_links') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stripe_customer_links' and column_name = 'user_id'
  ) then
    execute 'delete from public.stripe_customer_links where user_id = $1' using p_user_id;
  end if;

  if to_regclass('public.profiles') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'id'
  ) then
    execute 'delete from public.profiles where id = $1' using p_user_id;
  end if;

  if to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (
      actor_id,
      action,
      resource_type,
      resource_id,
      changes
    ) values (
      null,
      'account_deleted',
      'profile',
      p_user_id::text,
      jsonb_build_object(
        'request_id', nullif(coalesce(p_request_id, ''), ''),
        'initiator', 'self_service'
      )
    );
  end if;
end;
$$;

create or replace view public.admin_user_list as
select
  p.id,
  p.id::text as id_text,
  u.email,
  u.created_at as auth_created_at,
  p.account_type_id as tier,
  coalesce(p.monthly_message_count, 0) as messages_this_month,
  p.monthly_cap_override,
  p.monthly_reset_at,
  max(ue.created_at) as last_active_at,
  count(ue.id) as total_events
from public.profiles p
left join auth.users u on u.id = p.id
left join public.usage_events ue on ue.user_id = p.id
group by
  p.id,
  u.email,
  u.created_at,
  p.account_type_id,
  p.monthly_message_count,
  p.monthly_cap_override,
  p.monthly_reset_at;
