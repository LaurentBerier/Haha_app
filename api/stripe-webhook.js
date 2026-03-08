const { createHmac, timingSafeEqual } = require('node:crypto');
const { attachRequestId, getMissingEnv, getSupabaseAdmin, sendError, setCorsHeaders } = require('./_utils');

const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

async function readRawBodyFromStream(req) {
  if (!req || typeof req.on !== 'function') {
    return '';
  }

  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      reject(error);
    });
  });
}

async function resolveRawBody(req, requestId) {
  if (typeof req.rawBody === 'string' && req.rawBody) {
    return req.rawBody;
  }

  if (Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) {
    return req.rawBody.toString('utf8');
  }

  if (typeof req.body === 'string' && req.body) {
    return req.body;
  }

  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    return req.body.toString('utf8');
  }

  if (isRecord(req.body)) {
    console.error(`[api/stripe-webhook][${requestId}] Raw body unavailable because request body is pre-parsed JSON.`);
    return '';
  }

  try {
    return await readRawBodyFromStream(req);
  } catch (error) {
    console.error(`[api/stripe-webhook][${requestId}] Failed to read raw body stream`, error);
    return '';
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

function parseStripeSignature(headerValue) {
  const parsed = {
    timestamp: null,
    signatures: []
  };

  if (!headerValue) {
    return parsed;
  }

  for (const part of headerValue.split(',')) {
    const [rawKey, rawValue] = part.split('=');
    const key = (rawKey ?? '').trim();
    const value = (rawValue ?? '').trim();

    if (key === 't' && /^\d+$/.test(value)) {
      parsed.timestamp = Number.parseInt(value, 10);
      continue;
    }

    if (key === 'v1' && value) {
      parsed.signatures.push(value);
    }
  }

  return parsed;
}

function signatureMatches(expectedSignature, candidateSignature) {
  const expected = Buffer.from(expectedSignature, 'utf8');
  const candidate = Buffer.from(candidateSignature, 'utf8');
  if (expected.length !== candidate.length) {
    return false;
  }

  return timingSafeEqual(expected, candidate);
}

async function verifyStripeSignature(req, requestId) {
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  const rawBody = await resolveRawBody(req, requestId);
  const signatureHeader = toHeaderString(req.headers['stripe-signature']);
  const parsedSignature = parseStripeSignature(signatureHeader);

  if (!rawBody) {
    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Stripe webhook raw body is unavailable.'
    };
  }

  if (!webhookSecret || !parsedSignature.timestamp || parsedSignature.signatures.length === 0) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Invalid Stripe signature.' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsedSignature.timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Stripe signature timestamp is out of range.' };
  }

  const signedPayload = `${parsedSignature.timestamp}.${rawBody}`;
  const expectedSignature = createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
  const hasMatch = parsedSignature.signatures.some((candidate) => signatureMatches(expectedSignature, candidate));
  if (!hasMatch) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Invalid Stripe signature.' };
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (error) {
    console.error(`[api/stripe-webhook][${requestId}] Invalid JSON payload`, error);
    return { ok: false, status: 400, code: 'INVALID_REQUEST', message: 'Webhook payload must be valid JSON.' };
  }

  if (!isRecord(event) || typeof event.type !== 'string') {
    return { ok: false, status: 400, code: 'INVALID_REQUEST', message: 'Webhook event is malformed.' };
  }

  return { ok: true, event };
}

function getStripeProviderEventId(event) {
  return isRecord(event) && typeof event.id === 'string' && event.id.trim() ? event.id.trim() : '';
}

function getStripePlanMaps() {
  const linkMap = {};
  const priceMap = {};

  const regularLinkId = (process.env.STRIPE_PAYMENT_LINK_ID_REGULAR ?? '').trim();
  const premiumLinkId = (process.env.STRIPE_PAYMENT_LINK_ID_PREMIUM ?? '').trim();
  const regularPriceMonthly = (process.env.STRIPE_PRICE_ID_REGULAR_MONTHLY ?? '').trim();
  const regularPriceAnnual = (process.env.STRIPE_PRICE_ID_REGULAR_ANNUAL ?? '').trim();
  const premiumPriceMonthly = (process.env.STRIPE_PRICE_ID_PREMIUM_MONTHLY ?? '').trim();
  const premiumPriceAnnual = (process.env.STRIPE_PRICE_ID_PREMIUM_ANNUAL ?? '').trim();

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
    productId: typeof session.payment_link === 'string' ? session.payment_link : 'unknown'
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
    productId
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
  const corsResult = setCorsHeaders(req, res);
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

  const missingEnv = getMissingEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_WEBHOOK_SECRET']);
  if (missingEnv.length > 0 || !supabaseAdmin) {
    if (missingEnv.length > 0) {
      console.error(`[api/stripe-webhook][${requestId}] Missing env vars: ${missingEnv.join(', ')}`);
    }
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

  const { linkMap, priceMap } = getStripePlanMaps();
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

    const { error: eventError } = await supabaseAdmin.from('payment_events').insert({
      user_id: userId,
      provider: 'stripe',
      event_type: stripeEvent.eventType,
      product_id: stripeEvent.productId,
      account_type_id: stripeEvent.accountTypeId,
      raw_payload: {
        ...event,
        _provider_event_id: providerEventId || null
      }
    });

    if (eventError) {
      sendError(res, 500, eventError.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    if (stripeEvent.accountTypeId) {
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
        sendError(res, 500, metadataError.message, { code: 'SERVER_ERROR', requestId });
        return;
      }
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
