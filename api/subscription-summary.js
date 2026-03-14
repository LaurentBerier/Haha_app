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

function toProfileAccountType(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function toIsoFromStripeTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
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

async function fetchStripeLink(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('stripe_customer_links')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    return { ok: false, error };
  }

  return {
    ok: true,
    link: data
      ? {
          stripeCustomerId: typeof data.stripe_customer_id === 'string' ? data.stripe_customer_id : '',
          stripeSubscriptionId: typeof data.stripe_subscription_id === 'string' ? data.stripe_subscription_id : ''
        }
      : null
  };
}

async function fetchProfileAccountType(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('account_type_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return { ok: false, error };
  }

  return {
    ok: true,
    accountType: toProfileAccountType(data?.account_type_id)
  };
}

async function fetchStripeSubscription(stripeSecretKey, stripeSubscriptionId, requestId) {
  const response = await fetch(`${STRIPE_API_BASE_URL}/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`
    }
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    console.error(`[api/subscription-summary][${requestId}] Stripe fetch failed`, {
      status: response.status,
      payload
    });
    return {
      ok: false,
      status: response.status >= 500 ? 502 : 400,
      message: extractStripeErrorMessage(payload)
    };
  }

  return { ok: true, subscription: payload };
}

function getStripeSecretKeyCandidates() {
  const live = (process.env.STRIPE_SECRET_KEY ?? '').trim();
  const test = (process.env.STRIPE_SECRET_KEY_TEST ?? '').trim();
  return Array.from(new Set([live, test].filter(Boolean)));
}

async function fetchStripeSubscriptionWithFallback(stripeSecretKeys, stripeSubscriptionId, requestId) {
  let lastFailure = { ok: false, status: 500, message: 'Stripe API request failed.' };

  for (const stripeSecretKey of stripeSecretKeys) {
    const result = await fetchStripeSubscription(stripeSecretKey, stripeSubscriptionId, requestId);
    if (result.ok) {
      return result;
    }

    lastFailure = result;

    // Continue trying only when the subscription might exist in the other Stripe mode.
    if (result.status !== 400 && result.status !== 404) {
      break;
    }
  }

  return lastFailure;
}

module.exports = async function handler(req, res) {
  const requestId = attachRequestId(req, res);
  const corsResult = setCorsHeaders(req, res, { methods: 'GET, OPTIONS' });

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

  if (req.method !== 'GET') {
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

  let accountType = toAccountType(auth.user);
  let accountTypeSource = 'auth';
  const profileAccountTypeLookup = await fetchProfileAccountType(supabaseAdmin, auth.user.id);
  if (profileAccountTypeLookup.ok && profileAccountTypeLookup.accountType) {
    accountType = profileAccountTypeLookup.accountType;
    accountTypeSource = 'profile';
  } else if (!profileAccountTypeLookup.ok) {
    console.error(`[api/subscription-summary][${requestId}] Failed to read profile account type`, profileAccountTypeLookup.error);
  }

  const linkLookup = await fetchStripeLink(supabaseAdmin, auth.user.id);
  if (!linkLookup.ok) {
    sendError(res, 500, linkLookup.error.message, { code: 'SERVER_ERROR', requestId });
    return;
  }

  const stripeLink = linkLookup.link;
  const stripeSecretKeys = getStripeSecretKeyCandidates();

  if (!stripeLink || !stripeLink.stripeSubscriptionId || stripeSecretKeys.length === 0) {
    res.status(200).json({
      userId: auth.user.id,
      accountType,
      accountTypeSource,
      provider: stripeLink ? 'stripe' : null,
      subscriptionStatus: null,
      nextBillingDate: null,
      cancelAtPeriodEnd: false,
      canCancel: false
    });
    return;
  }

  const stripeSubscription = await fetchStripeSubscriptionWithFallback(
    stripeSecretKeys,
    stripeLink.stripeSubscriptionId,
    requestId
  );
  if (!stripeSubscription.ok) {
    sendError(res, stripeSubscription.status, stripeSubscription.message, { code: 'SERVER_ERROR', requestId });
    return;
  }

  const subscription = stripeSubscription.subscription;
  const subscriptionStatus =
    subscription && typeof subscription.status === 'string' ? subscription.status : null;
  const cancelAtPeriodEnd = Boolean(subscription && subscription.cancel_at_period_end);
  const nextBillingDate = toIsoFromStripeTimestamp(subscription ? subscription.current_period_end : null);

  const cancellableStatuses = new Set(['trialing', 'active', 'past_due', 'unpaid']);
  const canCancel = Boolean(subscriptionStatus && cancellableStatuses.has(subscriptionStatus) && !cancelAtPeriodEnd);

  res.status(200).json({
    userId: auth.user.id,
    accountType,
    accountTypeSource,
    provider: 'stripe',
    subscriptionStatus,
    nextBillingDate,
    cancelAtPeriodEnd,
    canCancel
  });
};
