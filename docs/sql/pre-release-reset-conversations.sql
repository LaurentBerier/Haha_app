-- PRE-RELEASE ONLY: destructive reset for conversation/memory data.
-- This script is intentionally guarded. It will fail until you set confirmation := 'YES'.
--
-- Scope:
-- - public.messages (when table exists)
-- - public.conversations (when table exists)
-- - public.primary_thread_messages
-- - public.primary_threads
-- - public.relationship_memories
--
-- Usage:
-- 1) Open this file.
-- 2) In the guard block below, set confirmation := 'YES'.
-- 3) Run on dev/staging only.
-- 4) Revert confirmation value before committing if modified locally.

do $$
declare
  confirmation text := '__SET_TO_YES__';
begin
  if confirmation <> 'YES' then
    raise exception 'Reset blocked. Set confirmation := ''YES'' inside docs/sql/pre-release-reset-conversations.sql to execute.';
  end if;
end;
$$;

begin;

do $$
begin
  if to_regclass('public.messages') is not null then
    execute 'delete from public.messages';
  end if;

  if to_regclass('public.conversations') is not null then
    execute 'delete from public.conversations';
  end if;

  if to_regclass('public.primary_thread_messages') is not null then
    execute 'delete from public.primary_thread_messages';
  end if;

  if to_regclass('public.primary_threads') is not null then
    execute 'delete from public.primary_threads';
  end if;

  if to_regclass('public.relationship_memories') is not null then
    execute 'delete from public.relationship_memories';
  end if;
end;
$$;

commit;
