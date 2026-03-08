const { timingSafeEqual } = require('node:crypto');
const { attachRequestId, extractBearerToken, getMissingEnv, getSupabaseAdmin, logAuditEvent, sendError, setCorsHeaders } = require('./_utils');

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

function getProviderEventId(payload) {
  const event = isRecord(payload.event) ? payload.event : null;
  if (!event) {
    return '';
  }

  const candidates = [event.id, event.transaction_id, event.original_transaction_id];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
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

function isUniqueViolation(error) {
  return isRecord(error) && typeof error.code === 'string' && error.code === '23505';
}

function isMissingProviderEventIdColumn(error) {
  if (!isRecord(error)) {
    return false;
  }
  const code = typeof error.code === 'string' ? error.code : '';
  if (code === '42703') {
    return true;
  }
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return message.includes('provider_event_id');
}

async function insertPaymentEvent(supabaseAdmin, row) {
  const withProviderEventId = { ...row, provider_event_id: row.provider_event_id ?? null };
  let result = await supabaseAdmin.from('payment_events').insert(withProviderEventId);
  if (result.error && isMissingProviderEventIdColumn(result.error)) {
    const legacyRow = { ...withProviderEventId };
    delete legacyRow.provider_event_id;
    result = await supabaseAdmin.from('payment_events').insert(legacyRow);
  }
  return result;
}

function isAuthorized(req) {
  const sharedSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!sharedSecret) {
    return false;
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return false;
  }

  const tokenBuffer = Buffer.from(token, 'utf8');
  const secretBuffer = Buffer.from(sharedSecret, 'utf8');
  if (tokenBuffer.length !== secretBuffer.length) {
    return false;
  }

  return timingSafeEqual(tokenBuffer, secretBuffer);
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

async function isDuplicateRevenueCatEvent(supabaseAdmin, providerEventId) {
  if (!providerEventId) {
    return { ok: true, duplicate: false };
  }

  const { count, error } = await supabaseAdmin
    .from('payment_events')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'revenuecat')
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
  const providerEventId = getProviderEventId(req.body);
  const userId = getUserId(req.body);
  const productId = getProductId(req.body);
  const accountTypeId = mapProductToAccountType(productId, eventType);

  if (!userId) {
    sendError(res, 400, 'Webhook payload missing app_user_id.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  try {
    const duplicateCheck = await isDuplicateRevenueCatEvent(supabaseAdmin, providerEventId);
    if (!duplicateCheck.ok) {
      sendError(res, 500, duplicateCheck.error.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    if (duplicateCheck.duplicate) {
      res.status(200).json({ ok: true, duplicate: true, userId: userId || null, accountTypeId });
      return;
    }

    const { error: eventError } = await insertPaymentEvent(supabaseAdmin, {
      user_id: userId,
      provider: 'revenuecat',
      provider_event_id: providerEventId || null,
      event_type: eventType,
      product_id: productId || 'unknown',
      account_type_id: accountTypeId,
      raw_payload: {
        ...req.body,
        _provider_event_id: providerEventId || null
      }
    });

    if (eventError) {
      if (providerEventId && isUniqueViolation(eventError)) {
        res.status(200).json({ ok: true, duplicate: true, userId: userId || null, accountTypeId });
        return;
      }
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

      const { error: metadataError } = await updateAppMetadata(supabaseAdmin, userId, accountTypeId);

      if (metadataError) {
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
            provider: 'revenuecat',
            eventType,
            providerEventId: providerEventId || null,
            productId: productId || null,
            to: accountTypeId
          }
        },
        requestId
      );
    }

    res.status(200).json({ ok: true, userId: userId || null, accountTypeId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    console.error(`[api/payment-webhook][${requestId}] Unhandled error`, error);
    sendError(res, 500, message, { code: 'SERVER_ERROR', requestId });
  }
};
