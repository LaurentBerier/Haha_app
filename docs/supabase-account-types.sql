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
drop policy if exists "profiles: own update (no account_type)" on public.profiles;

create policy "profiles: own read"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "profiles: own insert"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy "profiles: own update (no account_type)"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and account_type_id = (select p.account_type_id from public.profiles p where p.id = auth.uid())
  );

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
          'account_type', new.account_type_id,
          'role', case when new.account_type_id = 'admin' then 'admin' else 'user' end
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
  event_type text not null,
  product_id text not null,
  account_type_id text references public.account_types(id),
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

alter table public.payment_events enable row level security;
drop policy if exists "payment_events: service-role only" on public.payment_events;
create policy "payment_events: service-role only"
  on public.payment_events
  for all
  using (false)
  with check (false);

-- Manual admin promotion helper.
-- update public.profiles set account_type_id = 'admin' where id = '<user-uuid>';

-- Verification query.
-- select id, label, rank from public.account_types order by rank;
