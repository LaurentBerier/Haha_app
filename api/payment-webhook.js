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

function isMissingProviderEventConflictConstraint(error) {
  if (!isRecord(error)) {
    return false;
  }
  const code = typeof error.code === 'string' ? error.code : '';
  if (code === '42P10') {
    return true;
  }
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return message.includes('no unique') && message.includes('on conflict');
}

async function upsertPaymentEventByProviderEventId(supabaseAdmin, row) {
  const { data, error } = await supabaseAdmin
    .from('payment_events')
    .upsert(row, {
      onConflict: 'provider,provider_event_id',
      ignoreDuplicates: true
    })
    .select('id');

  if (error) {
    if (isMissingProviderEventIdColumn(error) || isMissingProviderEventConflictConstraint(error)) {
      return { ok: false, unsupported: true, error };
    }
    return { ok: false, unsupported: false, error };
  }

  const insertedRows = Array.isArray(data) ? data.length : 0;
  return {
    ok: true,
    duplicate: insertedRows === 0
  };
}

async function insertPaymentEvent(supabaseAdmin, row) {
  const withProviderEventId = { ...row, provider_event_id: row.provider_event_id ?? null };

  const providerEventId = typeof row.provider_event_id === 'string' ? row.provider_event_id.trim() : '';
  if (providerEventId) {
    const upsertResult = await upsertPaymentEventByProviderEventId(supabaseAdmin, withProviderEventId);
    if (upsertResult.ok) {
      return { error: null, duplicate: upsertResult.duplicate };
    }
    if (!upsertResult.unsupported) {
      return { error: upsertResult.error, duplicate: false };
    }
  }

  let result = await supabaseAdmin.from('payment_events').insert(withProviderEventId);
  if (result.error && isMissingProviderEventIdColumn(result.error)) {
    const legacyRow = { ...withProviderEventId };
    delete legacyRow.provider_event_id;
    result = await supabaseAdmin.from('payment_events').insert(legacyRow);
  }

  if (result.error) {
    if (providerEventId && isUniqueViolation(result.error)) {
      return { error: null, duplicate: true };
    }
    return { error: result.error, duplicate: false };
  }

  return { error: null, duplicate: false };
}

function getAuthorizationStatus(req) {
  const sharedSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!sharedSecret) {
    return { ok: false, reason: 'missing_shared_secret' };
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return { ok: false, reason: 'missing_bearer_token' };
  }

  const tokenBuffer = Buffer.from(token, 'utf8');
  const secretBuffer = Buffer.from(sharedSecret, 'utf8');
  if (tokenBuffer.length !== secretBuffer.length) {
    return { ok: false, reason: 'token_length_mismatch' };
  }

  if (!timingSafeEqual(tokenBuffer, secretBuffer)) {
    return { ok: false, reason: 'token_mismatch' };
  }

  return { ok: true, reason: 'ok' };
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

  const authorization = getAuthorizationStatus(req);
  if (!authorization.ok) {
    console.error(`[api/payment-webhook][${requestId}] Unauthorized webhook call (${authorization.reason}).`);
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
  const rawPrice = isRecord(req.body.event) && typeof req.body.event.price_in_purchased_currency === 'number'
    ? req.body.event.price_in_purchased_currency
    : null;
  const amountCents = rawPrice !== null ? Math.round(rawPrice * 100) : null;

  if (!userId) {
    sendError(res, 400, 'Webhook payload missing app_user_id.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  try {
    const insertResult = await insertPaymentEvent(supabaseAdmin, {
      user_id: userId,
      provider: 'revenuecat',
      provider_event_id: providerEventId || null,
      event_type: eventType,
      product_id: productId || 'unknown',
      account_type_id: accountTypeId,
      amount_cents: amountCents,
      raw_payload: {
        ...req.body,
        _provider_event_id: providerEventId || null
      }
    });

    if (insertResult.error) {
      sendError(res, 500, insertResult.error.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    if (insertResult.duplicate) {
      res.status(200).json({ ok: true, duplicate: true, userId: userId || null, accountTypeId });
      return;
    }

    if (accountTypeId) {
      const previousAccountTypeId = await readCurrentAccountType(supabaseAdmin, userId);
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
        const { error: rollbackError } = await restorePreviousProfileAccountType(
          supabaseAdmin,
          userId,
          previousAccountTypeId
        );
        if (rollbackError) {
          console.error(`[api/payment-webhook][${requestId}] Failed to rollback profile account type`, rollbackError);
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
