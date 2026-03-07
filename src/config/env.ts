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
const EXPO_PUBLIC_STRIPE_CHECKOUT_URL = process.env.EXPO_PUBLIC_STRIPE_CHECKOUT_URL;
const EXPO_PUBLIC_PAYPAL_CHECKOUT_URL = process.env.EXPO_PUBLIC_PAYPAL_CHECKOUT_URL;
const EXPO_PUBLIC_APPLE_PAY_CHECKOUT_URL = process.env.EXPO_PUBLIC_APPLE_PAY_CHECKOUT_URL;
const EXPO_PUBLIC_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

export const USE_MOCK_LLM = readBoolean(EXPO_PUBLIC_USE_MOCK_LLM, false);
export const CLAUDE_PROXY_URL = EXPO_PUBLIC_CLAUDE_PROXY_URL ?? '';
export const API_BASE_URL = EXPO_PUBLIC_API_BASE_URL ?? '';
export const ANTHROPIC_MODEL = EXPO_PUBLIC_ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
export const SUPABASE_URL = EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const STRIPE_CHECKOUT_URL = EXPO_PUBLIC_STRIPE_CHECKOUT_URL ?? '';
export const PAYPAL_CHECKOUT_URL = EXPO_PUBLIC_PAYPAL_CHECKOUT_URL ?? '';
export const APPLE_PAY_CHECKOUT_URL = EXPO_PUBLIC_APPLE_PAY_CHECKOUT_URL ?? '';

const IS_DEV_RUNTIME =
  (typeof __DEV__ !== 'undefined' && __DEV__) || (typeof process.env.NODE_ENV === 'string' && process.env.NODE_ENV !== 'production');

if (USE_MOCK_LLM && !IS_DEV_RUNTIME) {
  console.warn('[env] USE_MOCK_LLM is enabled in a non-dev runtime. Verify EXPO_PUBLIC_USE_MOCK_LLM.');
}
