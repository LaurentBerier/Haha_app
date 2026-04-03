CREATE TABLE IF NOT EXISTS public.primary_threads (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  artist_id text NOT NULL,
  language text NOT NULL DEFAULT 'fr-CA',
  title text NOT NULL DEFAULT '',
  last_message_preview text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artist_id)
);
CREATE TABLE IF NOT EXISTS public.primary_thread_messages (
  user_id uuid NOT NULL,
  artist_id text NOT NULL,
  message_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'artist')),
  content text NOT NULL DEFAULT '',
  timestamp timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'complete' CHECK (status = 'complete'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artist_id, message_id),
  CONSTRAINT primary_thread_messages_thread_fkey
    FOREIGN KEY (user_id, artist_id)
    REFERENCES public.primary_threads(user_id, artist_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS primary_threads_user_updated_idx
  ON public.primary_threads (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS primary_thread_messages_user_artist_ts_idx
  ON public.primary_thread_messages (user_id, artist_id, timestamp DESC);
ALTER TABLE public.primary_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.primary_thread_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS primary_threads_select_own ON public.primary_threads;
CREATE POLICY primary_threads_select_own
  ON public.primary_threads
  FOR SELECT
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS primary_threads_insert_own ON public.primary_threads;
CREATE POLICY primary_threads_insert_own
  ON public.primary_threads
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS primary_threads_update_own ON public.primary_threads;
CREATE POLICY primary_threads_update_own
  ON public.primary_threads
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS primary_threads_delete_own ON public.primary_threads;
CREATE POLICY primary_threads_delete_own
  ON public.primary_threads
  FOR DELETE
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS primary_thread_messages_select_own ON public.primary_thread_messages;
CREATE POLICY primary_thread_messages_select_own
  ON public.primary_thread_messages
  FOR SELECT
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS primary_thread_messages_insert_own ON public.primary_thread_messages;
CREATE POLICY primary_thread_messages_insert_own
  ON public.primary_thread_messages
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS primary_thread_messages_update_own ON public.primary_thread_messages;
CREATE POLICY primary_thread_messages_update_own
  ON public.primary_thread_messages
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS primary_thread_messages_delete_own ON public.primary_thread_messages;
CREATE POLICY primary_thread_messages_delete_own
  ON public.primary_thread_messages
  FOR DELETE
  USING (auth.uid() = user_id);
CREATE OR REPLACE FUNCTION public.trim_primary_thread_messages(
  artist_id text,
  keep_count integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  normalized_artist_id text := nullif(trim(coalesce(artist_id, '')), '');
  current_user_id uuid := auth.uid();
  normalized_keep_count integer := greatest(coalesce(keep_count, 500), 0);
  deleted_count integer := 0;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user required';
  END IF;

  IF normalized_artist_id IS NULL THEN
    RAISE EXCEPTION 'artist_id is required';
  END IF;

  WITH ranked AS (
    SELECT
      message_id,
      row_number() OVER (
        ORDER BY
          timestamp DESC,
          updated_at DESC,
          created_at DESC,
          message_id DESC
      ) AS row_num
    FROM public.primary_thread_messages
    WHERE user_id = current_user_id
      AND artist_id = normalized_artist_id
  ),
  to_delete AS (
    SELECT message_id
    FROM ranked
    WHERE row_num > normalized_keep_count
  )
  DELETE FROM public.primary_thread_messages target
  USING to_delete
  WHERE target.user_id = current_user_id
    AND target.artist_id = normalized_artist_id
    AND target.message_id = to_delete.message_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.trim_primary_thread_messages(text, integer) TO authenticated;
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

  if to_regclass('public.primary_thread_messages') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'primary_thread_messages' and column_name = 'user_id'
  ) then
    execute 'delete from public.primary_thread_messages where user_id = $1' using p_user_id;
  end if;

  if to_regclass('public.primary_threads') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'primary_threads' and column_name = 'user_id'
  ) then
    execute 'delete from public.primary_threads where user_id = $1' using p_user_id;
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
