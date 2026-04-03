const Stripe = require('stripe');
const { attachRequestId, getMissingEnv, getSupabaseAdmin, logAuditEvent, sendError, setCorsHeaders } = require('./_utils');

const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;
const STRIPE_API_BASE_URL = 'https://api.stripe.com/v1';

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

async function readRawBodyFromStream(req) {
  if (!req || typeof req.on !== 'function' || req.readableEnded) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    req.on('end', () => {
      resolve(chunks.length > 0 ? Buffer.concat(chunks) : null);
    });
    req.on('error', (error) => {
      reject(error);
    });
  });
}

async function resolveRawBody(req, requestId) {
  if (typeof req.rawBody === 'string' && req.rawBody) {
    return Buffer.from(req.rawBody, 'utf8');
  }

  if (Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) {
    return req.rawBody;
  }

  if (typeof req.body === 'string' && req.body) {
    return Buffer.from(req.body, 'utf8');
  }

  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    return req.body;
  }

  if (isRecord(req.body)) {
    console.error(`[api/stripe-webhook][${requestId}] Raw body unavailable because request body is pre-parsed JSON.`);
    return null;
  }

  try {
    return await readRawBodyFromStream(req);
  } catch (error) {
    console.error(`[api/stripe-webhook][${requestId}] Failed to read raw body stream`, error);
    return null;
  }
}

function toHeaderString(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return '';
}

function isUniqueViolation(error) {
  return isRecord(error) && typeof error.code === 'string' && error.code === '23505';
}

async function insertPaymentEvent(supabaseAdmin, row) {
  const withProviderEventId = { ...row, provider_event_id: row.provider_event_id ?? null };
  return supabaseAdmin.from('payment_events').insert(withProviderEventId);
}

function getStripeSecretKeyCandidatesForEvent(livemodeHint) {
  const live = (process.env.STRIPE_SECRET_KEY ?? '').trim();
  const test = (process.env.STRIPE_SECRET_KEY_TEST ?? '').trim();

  if (livemodeHint === true) {
    return Array.from(new Set([live].filter(Boolean)));
  }

  if (livemodeHint === false) {
    return Array.from(new Set([test || live].filter(Boolean)));
  }

  return Array.from(new Set([live, test].filter(Boolean)));
}

async function fetchStripeEventFromApi(eventId, requestId, livemodeHint) {
  const eventIdValue = typeof eventId === 'string' ? eventId.trim() : '';
  if (!eventIdValue) {
    return { ok: false, status: 400, code: 'INVALID_REQUEST', message: 'Webhook event is malformed.' };
  }

  const secretKeys = getStripeSecretKeyCandidatesForEvent(livemodeHint);
  if (secretKeys.length === 0) {
    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Stripe webhook raw body is unavailable.'
    };
  }

  let lastStatus = 500;
  for (const key of secretKeys) {
    const response = await fetch(`${STRIPE_API_BASE_URL}/events/${encodeURIComponent(eventIdValue)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`
      }
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.ok && isRecord(payload)) {
      return { ok: true, event: payload };
    }

    lastStatus = response.status;
    const message = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string'
      ? payload.error.message
      : 'Failed to fetch Stripe event.';
    console.error(`[api/stripe-webhook][${requestId}] Failed to fetch Stripe event ${eventIdValue} (status=${response.status}): ${message}`);

    if (response.status >= 500) {
      break;
    }
  }

  return {
    ok: false,
    status: lastStatus >= 500 ? 502 : 401,
    code: 'UNAUTHORIZED',
    message: 'Invalid Stripe signature.'
  };
}

async function verifyStripeSignature(req, requestId) {
  const webhookSecretCandidates = Array.from(
    new Set([(process.env.STRIPE_WEBHOOK_SECRET ?? '').trim(), (process.env.STRIPE_WEBHOOK_SECRET_TEST ?? '').trim()].filter(Boolean))
  );
  const rawBody = await resolveRawBody(req, requestId);
  const signatureHeader = toHeaderString(req.headers['stripe-signature']);

  if (!rawBody || rawBody.length === 0) {
    // Some runtimes pre-parse body and consume the stream.
    // Fallback: fetch the event by ID directly from Stripe API.
    if (isRecord(req.body)) {
      const fallback = await fetchStripeEventFromApi(req.body.id, requestId, req.body.livemode);
      if (fallback.ok) {
        return { ok: true, event: fallback.event };
      }
      return fallback;
    }

    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Stripe webhook raw body is unavailable.'
    };
  }

  if (webhookSecretCandidates.length === 0 || !signatureHeader) {
    console.error(
      `[api/stripe-webhook][${requestId}] Signature verification rejected: missing configured webhook secret or signature header.`
    );
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Invalid Stripe signature.' };
  }

  let event = null;
  for (const webhookSecret of webhookSecretCandidates) {
    try {
      event = Stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret, STRIPE_SIGNATURE_TOLERANCE_SECONDS);
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[api/stripe-webhook][${requestId}] Signature verification failed for one configured secret: ${message}`);
    }
  }

  if (!event) {
    console.error(`[api/stripe-webhook][${requestId}] Signature verification failed for all configured Stripe webhook secrets.`);
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Invalid Stripe signature.' };
  }

  if (!isRecord(event) || typeof event.type !== 'string') {
    return { ok: false, status: 400, code: 'INVALID_REQUEST', message: 'Webhook event is malformed.' };
  }

  return { ok: true, event };
}

function getStripeProviderEventId(event) {
  return isRecord(event) && typeof event.id === 'string' && event.id.trim() ? event.id.trim() : '';
}

function getStripePlanMaps(isLiveMode) {
  const linkMap = {};
  const priceMap = {};

  const resolveEnvValue = (liveKey, testKey) => {
    const liveValue = (process.env[liveKey] ?? '').trim();
    const testValue = (process.env[testKey] ?? '').trim();
    return isLiveMode ? liveValue : testValue || liveValue;
  };

  const regularLinkId = resolveEnvValue('STRIPE_PAYMENT_LINK_ID_REGULAR', 'STRIPE_PAYMENT_LINK_ID_REGULAR_TEST');
  const premiumLinkId = resolveEnvValue('STRIPE_PAYMENT_LINK_ID_PREMIUM', 'STRIPE_PAYMENT_LINK_ID_PREMIUM_TEST');
  const regularPriceMonthly = resolveEnvValue('STRIPE_PRICE_ID_REGULAR_MONTHLY', 'STRIPE_PRICE_ID_REGULAR_MONTHLY_TEST');
  const regularPriceAnnual = resolveEnvValue('STRIPE_PRICE_ID_REGULAR_ANNUAL', 'STRIPE_PRICE_ID_REGULAR_ANNUAL_TEST');
  const premiumPriceMonthly = resolveEnvValue('STRIPE_PRICE_ID_PREMIUM_MONTHLY', 'STRIPE_PRICE_ID_PREMIUM_MONTHLY_TEST');
  const premiumPriceAnnual = resolveEnvValue('STRIPE_PRICE_ID_PREMIUM_ANNUAL', 'STRIPE_PRICE_ID_PREMIUM_ANNUAL_TEST');

  if (regularLinkId) {
    linkMap[regularLinkId] = 'regular';
  }
  if (premiumLinkId) {
    linkMap[premiumLinkId] = 'premium';
  }

  if (regularPriceMonthly) {
    priceMap[regularPriceMonthly] = 'regular';
  }
  if (regularPriceAnnual) {
    priceMap[regularPriceAnnual] = 'regular';
  }
  if (premiumPriceMonthly) {
    priceMap[premiumPriceMonthly] = 'premium';
  }
  if (premiumPriceAnnual) {
    priceMap[premiumPriceAnnual] = 'premium';
  }

  return { linkMap, priceMap };
}

function toPriceIdList(subscription) {
  if (!isRecord(subscription) || !isRecord(subscription.items) || !Array.isArray(subscription.items.data)) {
    return [];
  }

  return subscription.items.data
    .map((item) => (isRecord(item) && isRecord(item.price) && typeof item.price.id === 'string' ? item.price.id : ''))
    .filter(Boolean);
}

function accountTypeFromCheckoutSession(session, linkMap) {
  if (!isRecord(session)) {
    return null;
  }

  const paymentLinkId = typeof session.payment_link === 'string' ? session.payment_link : '';
  if (paymentLinkId && linkMap[paymentLinkId]) {
    return linkMap[paymentLinkId];
  }

  if (isRecord(session.metadata)) {
    if (session.metadata.account_type === 'regular' || session.metadata.tier === 'regular') {
      return 'regular';
    }
    if (session.metadata.account_type === 'premium' || session.metadata.tier === 'premium') {
      return 'premium';
    }
  }

  return null;
}

function accountTypeFromSubscription(subscription, priceMap) {
  const priceIds = toPriceIdList(subscription);
  for (const priceId of priceIds) {
    const accountType = priceMap[priceId];
    if (accountType) {
      return accountType;
    }
  }
  return null;
}

function extractCheckoutSessionData(event, linkMap) {
  const session = isRecord(event.data) && isRecord(event.data.object) ? event.data.object : null;
  if (!session) {
    return null;
  }

  return {
    eventType: 'checkout_completed',
    userId: typeof session.client_reference_id === 'string' ? session.client_reference_id : '',
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : '',
    stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : '',
    accountTypeId: accountTypeFromCheckoutSession(session, linkMap),
    productId: typeof session.payment_link === 'string' ? session.payment_link : 'unknown',
    amountCents: typeof session.amount_total === 'number' ? session.amount_total : null
  };
}

function extractSubscriptionData(event, priceMap) {
  const subscription = isRecord(event.data) && isRecord(event.data.object) ? event.data.object : null;
  if (!subscription) {
    return null;
  }

  const eventType = event.type === 'customer.subscription.deleted' ? 'cancelled' : 'updated';
  const accountTypeId =
    event.type === 'customer.subscription.deleted' ? 'free' : accountTypeFromSubscription(subscription, priceMap);
  const productId = toPriceIdList(subscription)[0] ?? 'unknown';

  return {
    eventType,
    userId: '',
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : '',
    stripeSubscriptionId: typeof subscription.id === 'string' ? subscription.id : '',
    accountTypeId,
    productId,
    amountCents: null
  };
}

function extractStripeEventData(event, linkMap, priceMap) {
  if (event.type === 'checkout.session.completed') {
    return extractCheckoutSessionData(event, linkMap);
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    return extractSubscriptionData(event, priceMap);
  }

  return null;
}

async function resolveUserIdFromLink(supabaseAdmin, stripeCustomerId, stripeSubscriptionId) {
  if (stripeSubscriptionId) {
    const { data } = await supabaseAdmin
      .from('stripe_customer_links')
      .select('user_id')
      .eq('stripe_subscription_id', stripeSubscriptionId)
      .maybeSingle();
    if (data && typeof data.user_id === 'string' && data.user_id) {
      return data.user_id;
    }
  }

  if (stripeCustomerId) {
    const { data } = await supabaseAdmin
      .from('stripe_customer_links')
      .select('user_id')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle();
    if (data && typeof data.user_id === 'string' && data.user_id) {
      return data.user_id;
    }
  }

  return '';
}

async function updateAppMetadata(supabaseAdmin, userId, accountTypeId) {
  const {
    data: userLookup,
    error: userLookupError
  } = await supabaseAdmin.auth.admin.getUserById(userId);

  if (userLookupError) {
    return { error: userLookupError };
  }

  const existingMetadata =
    userLookup && userLookup.user && typeof userLookup.user.app_metadata === 'object' && userLookup.user.app_metadata
      ? userLookup.user.app_metadata
      : {};

  return supabaseAdmin.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...existingMetadata,
      account_type: accountTypeId
    }
  });
}

async function readCurrentAccountType(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('account_type_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return typeof data?.account_type_id === 'string' ? data.account_type_id : null;
}

async function restorePreviousProfileAccountType(supabaseAdmin, userId, previousAccountTypeId) {
  return supabaseAdmin
    .from('profiles')
    .update({ account_type_id: previousAccountTypeId })
    .eq('id', userId);
}

async function isDuplicateStripeEvent(supabaseAdmin, providerEventId) {
  if (!providerEventId) {
    return { ok: true, duplicate: false };
  }

  const { count, error } = await supabaseAdmin
    .from('payment_events')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'stripe')
    .contains('raw_payload', { _provider_event_id: providerEventId });

  if (error) {
    return { ok: false, error };
  }

  return { ok: true, duplicate: (count ?? 0) > 0 };
}

module.exports = async function handler(req, res) {
  const requestId = attachRequestId(req, res);
  const supabaseAdmin = getSupabaseAdmin();
  const corsResult = setCorsHeaders(req, res, { allowMissingOrigin: true });
  if (!corsResult.ok) {
    if (corsResult.reason === 'cors_not_configured') {
      sendError(res, 500, 'Server misconfigured: ALLOWED_ORIGINS missing.', {
        code: 'SERVER_MISCONFIGURED',
        requestId
      });
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
  const hasWebhookSecret =
    (typeof process.env.STRIPE_WEBHOOK_SECRET === 'string' && process.env.STRIPE_WEBHOOK_SECRET.trim().length > 0) ||
    (typeof process.env.STRIPE_WEBHOOK_SECRET_TEST === 'string' && process.env.STRIPE_WEBHOOK_SECRET_TEST.trim().length > 0);
  if (missingEnv.length > 0 || !supabaseAdmin) {
    if (missingEnv.length > 0) {
      console.error(`[api/stripe-webhook][${requestId}] Missing env vars: ${missingEnv.join(', ')}`);
    }
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  if (!hasWebhookSecret) {
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const verification = await verifyStripeSignature(req, requestId);
  if (!verification.ok) {
    sendError(res, verification.status, verification.message, { code: verification.code, requestId });
    return;
  }

  const event = verification.event;
  const providerEventId = getStripeProviderEventId(event);
  const duplicateCheck = await isDuplicateStripeEvent(supabaseAdmin, providerEventId);
  if (!duplicateCheck.ok) {
    sendError(res, 500, duplicateCheck.error.message, { code: 'SERVER_ERROR', requestId });
    return;
  }

  if (duplicateCheck.duplicate) {
    res.status(200).json({ ok: true, duplicate: true, type: event.type });
    return;
  }

  const isLiveMode = Boolean(event && event.livemode);
  const { linkMap, priceMap } = getStripePlanMaps(isLiveMode);
  const stripeEvent = extractStripeEventData(event, linkMap, priceMap);
  if (!stripeEvent) {
    res.status(200).json({ ok: true, ignored: true, type: event.type });
    return;
  }

  let userId = stripeEvent.userId;
  if (!userId) {
    userId = await resolveUserIdFromLink(
      supabaseAdmin,
      stripeEvent.stripeCustomerId,
      stripeEvent.stripeSubscriptionId
    );
  }

  if (!userId) {
    sendError(res, 400, 'Unable to resolve user for Stripe event.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  try {
    if (stripeEvent.stripeCustomerId) {
      const { error: linkError } = await supabaseAdmin.from('stripe_customer_links').upsert(
        {
          user_id: userId,
          stripe_customer_id: stripeEvent.stripeCustomerId,
          stripe_subscription_id: stripeEvent.stripeSubscriptionId || null,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'stripe_customer_id' }
      );

      if (linkError) {
        sendError(res, 500, linkError.message, { code: 'SERVER_ERROR', requestId });
        return;
      }
    }

    const { error: eventError } = await insertPaymentEvent(supabaseAdmin, {
      user_id: userId,
      provider: 'stripe',
      provider_event_id: providerEventId || null,
      event_type: stripeEvent.eventType,
      product_id: stripeEvent.productId,
      account_type_id: stripeEvent.accountTypeId,
      amount_cents: stripeEvent.amountCents ?? null,
      raw_payload: {
        ...event,
        _provider_event_id: providerEventId || null
      }
    });

    if (eventError) {
      if (providerEventId && isUniqueViolation(eventError)) {
        res.status(200).json({ ok: true, duplicate: true, type: event.type });
        return;
      }
      sendError(res, 500, eventError.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    if (stripeEvent.accountTypeId) {
      const previousAccountTypeId = await readCurrentAccountType(supabaseAdmin, userId);
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({ account_type_id: stripeEvent.accountTypeId })
        .eq('id', userId);

      if (profileError) {
        sendError(res, 500, profileError.message, { code: 'SERVER_ERROR', requestId });
        return;
      }

      const { error: metadataError } = await updateAppMetadata(supabaseAdmin, userId, stripeEvent.accountTypeId);
      if (metadataError) {
        const { error: rollbackError } = await restorePreviousProfileAccountType(
          supabaseAdmin,
          userId,
          previousAccountTypeId
        );
        if (rollbackError) {
          console.error(`[api/stripe-webhook][${requestId}] Failed to rollback profile account type`, rollbackError);
        }
        sendError(res, 500, metadataError.message, { code: 'SERVER_ERROR', requestId });
        return;
      }

      await logAuditEvent(
        supabaseAdmin,
        req,
        {
          actorId: null,
          action: 'webhook_account_type_change',
          resourceType: 'profile',
          resourceId: userId,
          changes: {
            provider: 'stripe',
            eventType: stripeEvent.eventType,
            providerEventId: providerEventId || null,
            productId: stripeEvent.productId,
            to: stripeEvent.accountTypeId
          }
        },
        requestId
      );
    }

    res.status(200).json({
      ok: true,
      userId,
      accountTypeId: stripeEvent.accountTypeId,
      type: event.type
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    console.error(`[api/stripe-webhook][${requestId}] Unhandled error`, error);
    sendError(res, 500, message, { code: 'SERVER_ERROR', requestId });
  }
};
