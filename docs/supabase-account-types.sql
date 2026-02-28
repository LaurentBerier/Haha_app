-- Extensible account types and user mapping for Supabase.
-- Run in Supabase SQL editor.

create table if not exists account_types (
  id text primary key,
  label text not null,
  rank int not null default 0,
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into account_types (id, label, rank, permissions, is_system)
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

alter table profiles
  add column if not exists account_type_id text not null default 'free' references account_types(id);

-- Optional helper to promote a user to admin.
-- update profiles set account_type_id = 'admin' where id = '<user-uuid>';

-- Keep JWT app_metadata in sync when needed (recommended for API checks).
-- select auth.admin_update_user_by_id('<user-uuid>', '{"app_metadata": {"account_type": "premium", "role": "user"}}'::jsonb);

-- Admin account-type management API
-- Endpoint: POST /api/admin-account-type
-- Required auth: Bearer token for a user with app_metadata.role='admin' or app_metadata.account_type='admin'
-- Payload:
-- {
--   "userId": "<target-user-uuid>",
--   "accountTypeId": "free|regular|premium|admin|<custom>"
-- }
