-- Supabase account types + profile linking + payment event groundwork.
-- Prerequisite: run core schema first (profiles table must already exist).

create table if not exists public.account_types (
  id text primary key,
  label text not null,
  rank int not null default 0,
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.account_types (id, label, rank, permissions, is_system)
values
  ('free', 'Free', 0, array['chat:basic'], true),
  ('regular', 'Regular', 1, array['chat:basic','chat:unlimited'], true),
  ('premium', 'Premium', 2, array['chat:basic','chat:unlimited','artists:premium'], true),
  ('admin', 'Admin', 99, array['admin:all','billing:manage','chat:basic','chat:unlimited','artists:premium'], true)
on conflict (id) do update
set
  label = excluded.label,
  rank = excluded.rank,
  permissions = excluded.permissions,
  is_system = excluded.is_system,
  updated_at = now();

-- Remove legacy account types completely.
-- 1) Remap users that still have legacy values.
update public.profiles
set account_type_id = case account_type_id
  when 'core' then 'regular'
  when 'pro' then 'premium'
  else account_type_id
end
where account_type_id in ('core', 'pro');

-- 2) Delete legacy rows from account_types table.
delete from public.account_types where id in ('core', 'pro');

alter table public.profiles
  add column if not exists account_type_id text not null default 'free' references public.account_types(id);

-- Keep updated_at fresh on manual updates.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists account_types_set_updated_at on public.account_types;
create trigger account_types_set_updated_at
before update on public.account_types
for each row execute function public.set_updated_at();

-- account_types must be readable by clients, writable only by service_role.
alter table public.account_types enable row level security;
drop policy if exists "account_types: read-only for all" on public.account_types;
create policy "account_types: read-only for all"
  on public.account_types
  for select
  using (true);

-- Harden profiles policies against self-promotion.
drop policy if exists "own profile" on public.profiles;
drop policy if exists "profiles: own read" on public.profiles;
drop policy if exists "profiles: own insert" on public.profiles;
drop policy if exists "profiles: own update (locked account_type)" on public.profiles;

create policy "profiles: own read"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "profiles: own insert"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy "profiles: own update (locked account_type)"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Prevent self-promotion via race conditions:
-- if a signed-in user updates their own profile, account_type_id is immutable.
create or replace function public.prevent_profile_account_type_change()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null
     and new.id = auth.uid()
     and new.account_type_id is distinct from old.account_type_id then
    raise exception 'account_type_id is immutable for self updates';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_lock_account_type on public.profiles;
create trigger profiles_lock_account_type
before update on public.profiles
for each row execute function public.prevent_profile_account_type_change();

-- Sync account_type_id to auth.users.app_metadata whenever admins/webhooks change it.
create or replace function public.sync_account_type_to_jwt()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'UPDATE' and new.account_type_id is distinct from old.account_type_id then
    perform auth.admin_update_user_by_id(
      new.id,
      jsonb_build_object(
        'app_metadata',
        jsonb_build_object(
          'account_type', new.account_type_id
        )
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_jwt on public.profiles;
create trigger profiles_sync_jwt
after update of account_type_id on public.profiles
for each row execute function public.sync_account_type_to_jwt();

-- Payment event ledger for webhook audits and replay safety.
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('revenuecat','stripe','apple')),
  provider_event_id text,
  event_type text not null,
  product_id text not null,
  account_type_id text references public.account_types(id),
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

-- Backward-compatible migration from older schemas:
-- ensure provider_event_id exists, and backfill from legacy transaction_id when present.
alter table public.payment_events
  add column if not exists provider_event_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_events'
      and column_name = 'transaction_id'
  ) then
    execute $sql$
      update public.payment_events
      set provider_event_id = coalesce(provider_event_id, transaction_id)
      where provider_event_id is null
        and transaction_id is not null
    $sql$;
  end if;
end
$$;

create unique index if not exists payment_events_provider_event_unique_idx
  on public.payment_events (provider, provider_event_id)
  where provider_event_id is not null;

-- Stripe customer/subscription linkage for webhook entitlement sync.
create table if not exists public.stripe_customer_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_customer_links_user_idx
  on public.stripe_customer_links (user_id);

alter table public.payment_events enable row level security;
drop policy if exists "payment_events: service-role only" on public.payment_events;
create policy "payment_events: service-role only"
  on public.payment_events
  for all
  using (false)
  with check (false);

alter table public.stripe_customer_links enable row level security;
drop policy if exists "stripe_customer_links: service-role only" on public.stripe_customer_links;
create policy "stripe_customer_links: service-role only"
  on public.stripe_customer_links
  for all
  using (false)
  with check (false);

-- Audit ledger for privileged operations and webhook-driven entitlement updates.
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  resource_type text,
  resource_id text,
  changes jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);

create index if not exists audit_logs_action_created_at_idx
  on public.audit_logs (action, created_at desc);

alter table public.audit_logs enable row level security;
drop policy if exists "audit_logs: service-role only" on public.audit_logs;
create policy "audit_logs: service-role only"
  on public.audit_logs
  for all
  using (false)
  with check (false);

-- Usage event ledger for server-side quota/rate limiting (Claude proxy).
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  request_id text,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_endpoint_created_at_idx
  on public.usage_events (user_id, endpoint, created_at desc);

-- Counters used by public.enforce_claude_limits RPC.
alter table public.profiles
  add column if not exists monthly_message_count int not null default 0;

alter table public.profiles
  add column if not exists monthly_reset_at timestamptz not null default date_trunc('month', now());

update public.profiles
set monthly_message_count = coalesce(monthly_message_count, 0),
    monthly_reset_at = coalesce(monthly_reset_at, date_trunc('month', now()))
where monthly_message_count is null
   or monthly_reset_at is null;

-- Optional RPC path to collapse quota check + rate-limit check + usage insert
-- into one server round-trip (used by /api/claude when CLAUDE_LIMITS_RPC=true).
create or replace function public.enforce_claude_limits(
  p_user_id uuid,
  p_account_type text,
  p_request_id text,
  p_now_iso timestamptz,
  p_window_start_iso timestamptz,
  p_month_start_iso timestamptz,
  p_rate_limit_max int,
  p_monthly_cap int
)
returns table (
  allowed boolean,
  status_code int,
  error_code text,
  error_message text,
  retry_after_seconds int,
  monthly_used int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now_iso, now());
  v_window_start timestamptz := coalesce(p_window_start_iso, now() - interval '1 minute');
  v_month_start timestamptz := coalesce(p_month_start_iso, date_trunc('month', now()));
  v_rate_limit_max int := greatest(coalesce(p_rate_limit_max, 1), 1);
  v_monthly_cap int := coalesce(p_monthly_cap, 0);
  v_recent_count int := 0;
  v_monthly_count int := 0;
  v_monthly_reset_at timestamptz;
  v_retry_after_seconds int;
  v_is_admin boolean := coalesce(p_account_type, 'free') = 'admin';
begin
  if p_user_id is null then
    return query select false, 401, 'UNAUTHORIZED', 'Unauthorized.', 0, 0;
    return;
  end if;

  select monthly_message_count, monthly_reset_at
  into v_monthly_count, v_monthly_reset_at
  from public.profiles
  where id = p_user_id
  for update;

  if v_monthly_count is null then
    v_monthly_count := 0;
  end if;

  if v_monthly_reset_at is null or v_monthly_reset_at < v_month_start then
    v_monthly_count := 0;
    update public.profiles
    set monthly_message_count = 0, monthly_reset_at = v_month_start
    where id = p_user_id;
  end if;

  if not v_is_admin and v_monthly_cap > 0 and v_monthly_count >= v_monthly_cap then
    v_retry_after_seconds := greatest(
      1,
      ceil(extract(epoch from (date_trunc('month', v_now) + interval '1 month') - v_now))::int
    );
    return query select
      false,
      429,
      'MONTHLY_QUOTA_EXCEEDED',
      format('Monthly message quota exceeded. Limit: %s messages.', v_monthly_cap),
      v_retry_after_seconds,
      v_monthly_count;
    return;
  end if;

  select count(*)::int
  into v_recent_count
  from public.usage_events
  where user_id = p_user_id
    and endpoint = 'claude'
    and created_at >= v_window_start;

  if v_recent_count >= v_rate_limit_max then
    return query select
      false,
      429,
      'RATE_LIMIT_EXCEEDED',
      'Rate limit exceeded.',
      60,
      v_monthly_count;
    return;
  end if;

  begin
    insert into public.usage_events(user_id, endpoint, request_id, created_at)
    values (p_user_id, 'claude', nullif(p_request_id, ''), v_now);
  exception
    when undefined_column then
      insert into public.usage_events(user_id, endpoint, created_at)
      values (p_user_id, 'claude', v_now);
  end;

  if not v_is_admin then
    update public.profiles
    set monthly_message_count = coalesce(monthly_message_count, 0) + 1,
        monthly_reset_at = v_month_start
    where id = p_user_id;
    v_monthly_count := v_monthly_count + 1;
  end if;

  return query select true, 200, null::text, null::text, 0, v_monthly_count;
end;
$$;

revoke all on function public.enforce_claude_limits(uuid, text, text, timestamptz, timestamptz, timestamptz, int, int)
  from public;
grant execute on function public.enforce_claude_limits(uuid, text, text, timestamptz, timestamptz, timestamptz, int, int)
  to service_role;

alter table public.usage_events enable row level security;
drop policy if exists "usage_events: service-role only" on public.usage_events;
create policy "usage_events: service-role only"
  on public.usage_events
  for all
  using (false)
  with check (false);

-- Manual admin promotion helper.
-- update public.profiles set account_type_id = 'admin' where id = '<user-uuid>';

-- Verification query.
-- select id, label, rank from public.account_types order by rank;
