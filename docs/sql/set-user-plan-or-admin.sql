-- Set one user's subscription tier (free/regular/premium/admin)
-- and optionally sync auth metadata role for immediate admin access.
--
-- Usage:
-- 1) Open Supabase SQL Editor
-- 2) Replace v_user_id + v_target_account_type below
-- 3) Run script

-- Compatibility fix:
-- Some Supabase projects do not expose auth.admin_update_user_by_id(uuid, jsonb).
-- This trigger implementation updates auth.users metadata directly.
create or replace function public.sync_account_type_to_jwt()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'UPDATE' and new.account_type_id is distinct from old.account_type_id then
    update auth.users
    set raw_app_meta_data = jsonb_set(
      coalesce(raw_app_meta_data, '{}'::jsonb),
      '{account_type}',
      to_jsonb(new.account_type_id),
      true
    )
    where id = new.id;
  end if;
  return new;
end;
$$;

begin;

do $$
declare
  -- REQUIRED
  v_user_id uuid := 'USER_ID'::uuid;
  v_target_account_type text := 'regular'; -- free | regular | premium | admin

  -- OPTIONAL
  v_sync_auth_metadata boolean := true;
  -- true: role follows account_type (admin -> admin, otherwise user)
  -- false: keep current role untouched, only update account_type
  v_sync_role_with_tier boolean := true;

  v_profile_exists boolean;
  v_account_type_exists boolean;
  v_target_role text;
begin
  select exists(
    select 1
    from public.profiles
    where id = v_user_id
  ) into v_profile_exists;

  if not v_profile_exists then
    raise exception 'Profile not found for user id: %', v_user_id;
  end if;

  select exists(
    select 1
    from public.account_types
    where id = v_target_account_type
  ) into v_account_type_exists;

  if not v_account_type_exists then
    raise exception 'Invalid account_type_id: % (expected free/regular/premium/admin)', v_target_account_type;
  end if;

  update public.profiles
  set account_type_id = v_target_account_type
  where id = v_user_id;

  if v_sync_auth_metadata then
    v_target_role := case
      when v_sync_role_with_tier and v_target_account_type = 'admin' then 'admin'
      when v_sync_role_with_tier then 'user'
      else null
    end;

    update auth.users
    set raw_app_meta_data = case
      when v_target_role is null then
        jsonb_set(
          coalesce(raw_app_meta_data, '{}'::jsonb),
          '{account_type}',
          to_jsonb(v_target_account_type),
          true
        )
      else
        jsonb_set(
          jsonb_set(
            coalesce(raw_app_meta_data, '{}'::jsonb),
            '{account_type}',
            to_jsonb(v_target_account_type),
            true
          ),
          '{role}',
          to_jsonb(v_target_role),
          true
        )
    end
    where id = v_user_id;
  end if;
end
$$;

-- Verification
select
  p.id as user_id,
  p.account_type_id as profile_account_type,
  u.raw_app_meta_data ->> 'account_type' as auth_account_type,
  u.raw_app_meta_data ->> 'role' as auth_role,
  p.updated_at as profile_updated_at
from public.profiles p
left join auth.users u on u.id = p.id
where p.id = 'USER_ID'::uuid;

commit;
