ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS greeting_tutorial_sessions_count INTEGER NOT NULL DEFAULT 0;
