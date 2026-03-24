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

function readStripeMode(value: string | undefined): 'live' | 'test' {
  if (typeof value !== 'string') {
    return 'live';
  }

  const normalized = value.trim().toLowerCase();
  if (['test', 'sandbox', 'dev', 'development'].includes(normalized)) {
    return 'test';
  }
  return 'live';
}

// Expo only inlines EXPO_PUBLIC_* values when accessed via direct
// process.env.EXPO_PUBLIC_* property reads.
const EXPO_PUBLIC_USE_MOCK_LLM = process.env.EXPO_PUBLIC_USE_MOCK_LLM;
const EXPO_PUBLIC_CLAUDE_PROXY_URL = process.env.EXPO_PUBLIC_CLAUDE_PROXY_URL;
const EXPO_PUBLIC_ANTHROPIC_MODEL = process.env.EXPO_PUBLIC_ANTHROPIC_MODEL;
const EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EXPO_PUBLIC_STRIPE_CHECKOUT_URL = process.env.EXPO_PUBLIC_STRIPE_CHECKOUT_URL;
const EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR = process.env.EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR;
const EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM = process.env.EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM;
const EXPO_PUBLIC_STRIPE_CHECKOUT_URL_TEST = process.env.EXPO_PUBLIC_STRIPE_CHECKOUT_URL_TEST;
const EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR_TEST = process.env.EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR_TEST;
const EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM_TEST = process.env.EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM_TEST;
const EXPO_PUBLIC_STRIPE_MODE = process.env.EXPO_PUBLIC_STRIPE_MODE;
const EXPO_PUBLIC_PAYPAL_CHECKOUT_URL = process.env.EXPO_PUBLIC_PAYPAL_CHECKOUT_URL;
const EXPO_PUBLIC_APPLE_PAY_CHECKOUT_URL = process.env.EXPO_PUBLIC_APPLE_PAY_CHECKOUT_URL;
const EXPO_PUBLIC_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
const EXPO_PUBLIC_E2E_AUTH_BYPASS = process.env.EXPO_PUBLIC_E2E_AUTH_BYPASS;
const EXPO_PUBLIC_GREETING_FORCE_TUTORIAL = process.env.EXPO_PUBLIC_GREETING_FORCE_TUTORIAL;
const EXPO_PUBLIC_SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

const IS_DEV_RUNTIME =
  (typeof __DEV__ !== 'undefined' && __DEV__) ||
  (typeof process.env.NODE_ENV === 'string' && process.env.NODE_ENV !== 'production');
const RAW_E2E_AUTH_BYPASS = readBoolean(EXPO_PUBLIC_E2E_AUTH_BYPASS, false);

export const USE_MOCK_LLM = readBoolean(EXPO_PUBLIC_USE_MOCK_LLM, false);
export const CLAUDE_PROXY_URL = EXPO_PUBLIC_CLAUDE_PROXY_URL ?? '';
export const API_BASE_URL = EXPO_PUBLIC_API_BASE_URL ?? '';
export const ANTHROPIC_MODEL = EXPO_PUBLIC_ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
export const SUPABASE_URL = EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const STRIPE_CHECKOUT_MODE = readStripeMode(EXPO_PUBLIC_STRIPE_MODE);

const STRIPE_CHECKOUT_URL_LIVE = EXPO_PUBLIC_STRIPE_CHECKOUT_URL ?? '';
const STRIPE_CHECKOUT_URL_LIVE_REGULAR = EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR ?? STRIPE_CHECKOUT_URL_LIVE;
const STRIPE_CHECKOUT_URL_LIVE_PREMIUM = EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM ?? '';
const STRIPE_CHECKOUT_URL_TEST_LEGACY = EXPO_PUBLIC_STRIPE_CHECKOUT_URL_TEST ?? STRIPE_CHECKOUT_URL_LIVE;
const STRIPE_CHECKOUT_URL_TEST_REGULAR =
  EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR_TEST ??
  EXPO_PUBLIC_STRIPE_CHECKOUT_URL_REGULAR ??
  STRIPE_CHECKOUT_URL_TEST_LEGACY;
const STRIPE_CHECKOUT_URL_TEST_PREMIUM =
  EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM_TEST ??
  EXPO_PUBLIC_STRIPE_CHECKOUT_URL_PREMIUM ??
  STRIPE_CHECKOUT_URL_TEST_LEGACY;

export const STRIPE_CHECKOUT_URL = STRIPE_CHECKOUT_MODE === 'test' ? STRIPE_CHECKOUT_URL_TEST_LEGACY : STRIPE_CHECKOUT_URL_LIVE;
export const STRIPE_CHECKOUT_URL_REGULAR =
  STRIPE_CHECKOUT_MODE === 'test' ? STRIPE_CHECKOUT_URL_TEST_REGULAR : STRIPE_CHECKOUT_URL_LIVE_REGULAR;
export const STRIPE_CHECKOUT_URL_PREMIUM =
  STRIPE_CHECKOUT_MODE === 'test' ? STRIPE_CHECKOUT_URL_TEST_PREMIUM : STRIPE_CHECKOUT_URL_LIVE_PREMIUM;
export const PAYPAL_CHECKOUT_URL = EXPO_PUBLIC_PAYPAL_CHECKOUT_URL ?? '';
export const APPLE_PAY_CHECKOUT_URL = EXPO_PUBLIC_APPLE_PAY_CHECKOUT_URL ?? '';
export const SENTRY_DSN = EXPO_PUBLIC_SENTRY_DSN ?? '';
// Safety guard: never allow test bypass flags in production bundles.
export const E2E_AUTH_BYPASS = RAW_E2E_AUTH_BYPASS && IS_DEV_RUNTIME;
export const GREETING_FORCE_TUTORIAL = readBoolean(EXPO_PUBLIC_GREETING_FORCE_TUTORIAL, false);

if (RAW_E2E_AUTH_BYPASS && !IS_DEV_RUNTIME) {
  console.warn('[env] E2E_AUTH_BYPASS is enabled in a production runtime. The flag is ignored for safety.');
}

if (USE_MOCK_LLM && !IS_DEV_RUNTIME) {
  console.warn('[env] USE_MOCK_LLM is enabled in a non-dev runtime. Verify EXPO_PUBLIC_USE_MOCK_LLM.');
}
