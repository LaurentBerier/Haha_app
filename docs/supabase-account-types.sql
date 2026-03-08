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
