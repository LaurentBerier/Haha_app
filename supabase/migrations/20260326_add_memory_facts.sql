ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS memory_facts text[] NOT NULL DEFAULT '{}';
