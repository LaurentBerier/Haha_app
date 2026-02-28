function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

// Expo only inlines EXPO_PUBLIC_* values when accessed via direct
// process.env.EXPO_PUBLIC_* property reads.
const EXPO_PUBLIC_USE_MOCK_LLM = process.env.EXPO_PUBLIC_USE_MOCK_LLM;
const EXPO_PUBLIC_CLAUDE_PROXY_URL = process.env.EXPO_PUBLIC_CLAUDE_PROXY_URL;
const EXPO_PUBLIC_ANTHROPIC_MODEL = process.env.EXPO_PUBLIC_ANTHROPIC_MODEL;
const EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const USE_MOCK_LLM = readBoolean(EXPO_PUBLIC_USE_MOCK_LLM, true);
export const CLAUDE_PROXY_URL = EXPO_PUBLIC_CLAUDE_PROXY_URL ?? '';
export const ANTHROPIC_MODEL = EXPO_PUBLIC_ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929';
export const SUPABASE_URL = EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
