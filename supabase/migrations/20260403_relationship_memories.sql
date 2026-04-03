CREATE TABLE IF NOT EXISTS public.relationship_memories (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  artist_id text NOT NULL,
  summary text NOT NULL DEFAULT '',
  key_facts text[] NOT NULL DEFAULT '{}',
  source_user_turn_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artist_id)
);

CREATE INDEX IF NOT EXISTS relationship_memories_user_updated_idx
  ON public.relationship_memories (user_id, updated_at DESC);

ALTER TABLE public.relationship_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS relationship_memories_select_own ON public.relationship_memories;
CREATE POLICY relationship_memories_select_own
  ON public.relationship_memories
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS relationship_memories_insert_own ON public.relationship_memories;
CREATE POLICY relationship_memories_insert_own
  ON public.relationship_memories
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS relationship_memories_update_own ON public.relationship_memories;
CREATE POLICY relationship_memories_update_own
  ON public.relationship_memories
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS relationship_memories_delete_own ON public.relationship_memories;
CREATE POLICY relationship_memories_delete_own
  ON public.relationship_memories
  FOR DELETE
  USING (auth.uid() = user_id);
