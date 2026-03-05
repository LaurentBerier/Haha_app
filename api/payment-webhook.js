const { createClient } = require('@supabase/supabase-js');
const { attachRequestId, extractBearerToken, getMissingEnv, sendError, setCorsHeaders } = require('./_utils');

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function toWebhookEventType(type) {
  if (type === 'INITIAL_PURCHASE') {
    return 'purchased';
  }
  if (type === 'RENEWAL') {
    return 'renewed';
  }
  if (type === 'CANCELLATION' || type === 'EXPIRATION') {
    return 'cancelled';
  }
  if (type === 'REFUND') {
    return 'refunded';
  }
  return 'updated';
}

function getUserId(payload) {
  const event = isRecord(payload.event) ? payload.event : null;
  if (!event) {
    return '';
  }

  const candidates = [
    event.app_user_id,
    event.original_app_user_id,
    event.aliases && Array.isArray(event.aliases) ? event.aliases[0] : null
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

function getProductId(payload) {
  const event = isRecord(payload.event) ? payload.event : null;
  if (!event) {
    return '';
  }

  const product = event.product_id;
  return typeof product === 'string' ? product : '';
}

function mapProductToAccountType(productId, eventType) {
  if (eventType === 'cancelled' || eventType === 'refunded') {
    return 'free';
  }

  const map = {
    haha_regular_monthly: 'regular',
    haha_regular_annual: 'regular',
    haha_premium_monthly: 'premium',
    haha_premium_annual: 'premium'
  };

  return map[productId] ?? null;
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin =
  typeof supabaseUrl === 'string' &&
  supabaseUrl &&
  typeof serviceRoleKey === 'string' &&
  serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey)
    : null;

function isAuthorized(req) {
  const sharedSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!sharedSecret) {
    return false;
  }

  const token = extractBearerToken(req.headers.authorization);
  return token === sharedSecret;
}

module.exports = async function handler(req, res) {
  const requestId = attachRequestId(req, res);
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

  const missingEnv = getMissingEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'REVENUECAT_WEBHOOK_SECRET']);
  if (missingEnv.length > 0 || !supabaseAdmin) {
    if (missingEnv.length > 0) {
      console.error(`[api/payment-webhook][${requestId}] Missing env vars: ${missingEnv.join(', ')}`);
    }
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  if (!isAuthorized(req)) {
    sendError(res, 401, 'Unauthorized webhook call.', { code: 'UNAUTHORIZED', requestId });
    return;
  }

  if (!isRecord(req.body)) {
    sendError(res, 400, 'JSON body is required.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  const sourceType = isRecord(req.body.event) && typeof req.body.event.type === 'string' ? req.body.event.type : 'UNKNOWN';
  const eventType = toWebhookEventType(sourceType);
  const userId = getUserId(req.body);
  const productId = getProductId(req.body);
  const accountTypeId = mapProductToAccountType(productId, eventType);

  if (!userId) {
    sendError(res, 400, 'Webhook payload missing app_user_id.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  try {
    const { error: eventError } = await supabaseAdmin.from('payment_events').insert({
      user_id: userId,
      provider: 'revenuecat',
      event_type: eventType,
      product_id: productId || 'unknown',
      account_type_id: accountTypeId,
      raw_payload: req.body
    });

    if (eventError) {
      sendError(res, 500, eventError.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    if (accountTypeId) {
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({ account_type_id: accountTypeId })
        .eq('id', userId);

      if (profileError) {
        sendError(res, 500, profileError.message, { code: 'SERVER_ERROR', requestId });
        return;
      }

      const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: {
          account_type: accountTypeId,
          role: accountTypeId === 'admin' ? 'admin' : 'user'
        }
      });

      if (metadataError) {
        sendError(res, 500, metadataError.message, { code: 'SERVER_ERROR', requestId });
        return;
      }
    }

    res.status(200).json({ ok: true, userId: userId || null, accountTypeId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    console.error(`[api/payment-webhook][${requestId}] Unhandled error`, error);
    sendError(res, 500, message, { code: 'SERVER_ERROR', requestId });
  }
};
