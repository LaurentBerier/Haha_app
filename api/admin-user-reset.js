const { kv } = require('@vercel/kv');
const {
  attachRequestId,
  extractBearerToken,
  getMissingEnv,
  getSupabaseAdmin,
  logAuditEvent,
  sendError,
  setCorsHeaders
} = require('./_utils');

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function isKvEnvironmentConfigured() {
  const hasConnectionString = typeof process.env.KV_URL === 'string' && process.env.KV_URL.trim().length > 0;
  const hasRestPair =
    typeof process.env.KV_REST_API_URL === 'string' &&
    process.env.KV_REST_API_URL.trim().length > 0 &&
    typeof process.env.KV_REST_API_TOKEN === 'string' &&
    process.env.KV_REST_API_TOKEN.trim().length > 0;
  const hasUpstashPair =
    typeof process.env.UPSTASH_REDIS_REST_URL === 'string' &&
    process.env.UPSTASH_REDIS_REST_URL.trim().length > 0 &&
    typeof process.env.UPSTASH_REDIS_REST_TOKEN === 'string' &&
    process.env.UPSTASH_REDIS_REST_TOKEN.trim().length > 0;
  return hasConnectionString || hasRestPair || hasUpstashPair;
}

function getMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function clearMonthlyQuotaCache(userId, monthStartIso, requestId) {
  if (!isKvEnvironmentConfigured()) {
    return;
  }

  try {
    await kv.del(`quota:${userId}:${monthStartIso}`);
  } catch (error) {
    console.error(`[api/admin-user-reset][${requestId}] Failed to clear monthly quota cache`, error);
  }
}

async function validateAdmin(supabaseAdmin, req, requestId) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return { ok: false, error: 'Missing bearer token', status: 401 };
  }

  if (!supabaseAdmin) {
    return { ok: false, error: 'Supabase admin client unavailable', status: 500 };
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return { ok: false, error: 'Unauthorized', status: 401 };
    }

    const role = typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : null;
    const accountType = typeof user.app_metadata?.account_type === 'string' ? user.app_metadata.account_type : null;
    if (role !== 'admin' && accountType !== 'admin') {
      return { ok: false, error: 'Forbidden', status: 403 };
    }

    return { ok: true, userId: user.id };
  } catch (err) {
    console.error(`[api/admin-user-reset][${requestId}] Token validation failed`, err);
    return { ok: false, error: 'Token validation failed', status: 401 };
  }
}

module.exports = async function handler(req, res) {
  const requestId = attachRequestId(req, res);
  const corsResult = setCorsHeaders(req, res);
  if (!corsResult.ok) {
    if (corsResult.reason === 'cors_not_configured') {
      sendError(res, 500, 'Server misconfigured: ALLOWED_ORIGINS missing.', { code: 'SERVER_MISCONFIGURED', requestId });
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
  const supabaseAdmin = getSupabaseAdmin();
  if (missingEnv.length > 0 || !supabaseAdmin) {
    if (missingEnv.length > 0) {
      console.error(`[api/admin-user-reset][${requestId}] Missing env vars: ${missingEnv.join(', ')}`);
    }
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const auth = await validateAdmin(supabaseAdmin, req, requestId);
  if (!auth.ok) {
    sendError(res, auth.status, auth.error, {
      code: auth.status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED',
      requestId
    });
    return;
  }

  if (!isRecord(req.body)) {
    sendError(res, 400, 'JSON body is required.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  const userId = typeof req.body.userId === 'string' ? req.body.userId.trim() : '';
  if (!userId) {
    sendError(res, 400, 'userId is required.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  const monthStartIso = getMonthStartIso();

  try {
    const { data: previousData, error: previousError } = await supabaseAdmin
      .from('profiles')
      .select('monthly_message_count, monthly_reset_at')
      .eq('id', userId)
      .maybeSingle();

    if (previousError) {
      console.error(`[api/admin-user-reset][${requestId}] Failed to read profile`, previousError);
      sendError(res, 500, 'Failed to read user profile.', { code: 'SERVER_ERROR', requestId });
      return;
    }

    const previousCount = typeof previousData?.monthly_message_count === 'number'
      ? previousData.monthly_message_count
      : null;
    const previousResetAt = typeof previousData?.monthly_reset_at === 'string'
      ? previousData.monthly_reset_at
      : null;

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        monthly_message_count: 0,
        monthly_reset_at: monthStartIso
      })
      .eq('id', userId);

    if (updateError) {
      console.error(`[api/admin-user-reset][${requestId}] Failed to reset profile usage`, updateError);
      sendError(res, 500, 'Failed to reset user usage.', { code: 'SERVER_ERROR', requestId });
      return;
    }

    await clearMonthlyQuotaCache(userId, monthStartIso, requestId);

    await logAuditEvent(
      supabaseAdmin,
      req,
      {
        actorId: auth.userId,
        action: 'usage_reset',
        resourceType: 'profile',
        resourceId: userId,
        changes: {
          from: {
            monthlyMessageCount: previousCount,
            monthlyResetAt: previousResetAt
          },
          to: {
            monthlyMessageCount: 0,
            monthlyResetAt: monthStartIso
          }
        }
      },
      requestId
    );

    res.status(200).json({
      ok: true,
      updatedBy: auth.userId,
      userId,
      monthlyMessageCount: 0,
      monthlyResetAt: monthStartIso
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    console.error(`[api/admin-user-reset][${requestId}] Unhandled error`, error);
    sendError(res, 500, message, { code: 'SERVER_ERROR', requestId });
  }
};
