const {
  attachRequestId,
  extractBearerToken,
  getMissingEnv,
  getSupabaseAdmin,
  sendError,
  setCorsHeaders
} = require('./_utils');

const STRIPE_API_BASE_URL = 'https://api.stripe.com/v1';

function toAccountType(user) {
  const raw = user && user.app_metadata && typeof user.app_metadata.account_type === 'string'
    ? user.app_metadata.account_type
    : 'free';
  return raw.trim() || 'free';
}

function extractStripeErrorMessage(payload) {
  if (
    payload &&
    typeof payload === 'object' &&
    payload.error &&
    typeof payload.error === 'object' &&
    typeof payload.error.message === 'string'
  ) {
    return payload.error.message;
  }
  return 'Stripe API request failed.';
}

function toIsoFromStripeTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}

function getStripeSecretKeyCandidates() {
  const live = (process.env.STRIPE_SECRET_KEY ?? '').trim();
  const test = (process.env.STRIPE_SECRET_KEY_TEST ?? '').trim();
  return Array.from(new Set([live, test].filter(Boolean)));
}

async function cancelStripeSubscription(stripeSecretKey, stripeSubscriptionId) {
  const body = new URLSearchParams({ cancel_at_period_end: 'true' });

  const response = await fetch(`${STRIPE_API_BASE_URL}/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status >= 500 ? 502 : 400,
      message: extractStripeErrorMessage(payload)
    };
  }

  return { ok: true, payload };
}

async function cancelStripeSubscriptionWithFallback(stripeSecretKeys, stripeSubscriptionId) {
  let lastFailure = { ok: false, status: 500, message: 'Stripe API request failed.' };

  for (const stripeSecretKey of stripeSecretKeys) {
    const result = await cancelStripeSubscription(stripeSecretKey, stripeSubscriptionId);
    if (result.ok) {
      return result;
    }

    lastFailure = result;
    if (result.status !== 400 && result.status !== 404) {
      break;
    }
  }

  return lastFailure;
}

async function getAuthenticatedUser(supabaseAdmin, token) {
  const {
    data: { user },
    error
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return { ok: false };
  }

  return { ok: true, user };
}

module.exports = async function handler(req, res) {
  const requestId = attachRequestId(req, res);
  const corsResult = setCorsHeaders(req, res, { methods: 'POST, OPTIONS' });

  if (!corsResult.ok) {
    if (corsResult.reason === 'cors_not_configured') {
      sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
      return;
    }

    sendError(res, 403, 'Origin not allowed.', { code: 'ORIGIN_NOT_ALLOWED', requestId });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed.', { code: 'METHOD_NOT_ALLOWED', requestId });
    return;
  }

  const missingEnv = getMissingEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (missingEnv.length > 0) {
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    sendError(res, 401, 'Unauthorized.', { code: 'UNAUTHORIZED', requestId });
    return;
  }

  const auth = await getAuthenticatedUser(supabaseAdmin, token);
  if (!auth.ok) {
    sendError(res, 401, 'Unauthorized.', { code: 'UNAUTHORIZED', requestId });
    return;
  }
  const accountType = toAccountType(auth.user);

  const { data: link, error: linkError } = await supabaseAdmin
    .from('stripe_customer_links')
    .select('stripe_subscription_id')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (linkError) {
    sendError(res, 500, linkError.message, { code: 'SERVER_ERROR', requestId });
    return;
  }

  const stripeSubscriptionId =
    link && typeof link.stripe_subscription_id === 'string' ? link.stripe_subscription_id.trim() : '';

  if (!stripeSubscriptionId) {
    sendError(res, 404, 'No active Stripe subscription found.', { code: 'NOT_FOUND', requestId });
    return;
  }

  const stripeSecretKeys = getStripeSecretKeyCandidates();
  if (stripeSecretKeys.length === 0) {
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const cancellation = await cancelStripeSubscriptionWithFallback(stripeSecretKeys, stripeSubscriptionId);
  if (!cancellation.ok) {
    sendError(res, cancellation.status, cancellation.message, { code: 'SERVER_ERROR', requestId });
    return;
  }

  const payload = cancellation.payload;

  const nextBillingDate = toIsoFromStripeTimestamp(payload ? payload.current_period_end : null);

  res.status(200).json({
    ok: true,
    accountType,
    subscriptionStatus: payload && typeof payload.status === 'string' ? payload.status : null,
    nextBillingDate,
    cancelAtPeriodEnd: Boolean(payload && payload.cancel_at_period_end),
    canCancel: false
  });
};
