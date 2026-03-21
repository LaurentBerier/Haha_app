const { attachRequestId, extractBearerToken, getMissingEnv, getSupabaseAdmin, logAuditEvent, sendError, setCorsHeaders } = require('./_utils');

function isRecord(value) {
  return typeof value === 'object' && value !== null;
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
    console.error(`[api/admin-quota-override][${requestId}] Token validation failed`, err);
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
      console.error(`[api/admin-quota-override][${requestId}] Missing env vars: ${missingEnv.join(', ')}`);
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

  // monthlyCap: positive integer to set override, null to remove override
  let monthlyCap = null;
  if (req.body.monthlyCap !== null && req.body.monthlyCap !== undefined) {
    const parsed = Number.parseInt(String(req.body.monthlyCap), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      sendError(res, 400, 'monthlyCap must be a non-negative integer or null.', { code: 'INVALID_REQUEST', requestId });
      return;
    }
    monthlyCap = parsed;
  }

  try {
    // Read previous value for audit log
    const { data: previous } = await supabaseAdmin
      .from('profiles')
      .select('monthly_cap_override')
      .eq('id', userId)
      .maybeSingle();

    const previousCap = previous && typeof previous.monthly_cap_override === 'number'
      ? previous.monthly_cap_override
      : null;

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ monthly_cap_override: monthlyCap })
      .eq('id', userId);

    if (updateError) {
      console.error(`[api/admin-quota-override][${requestId}] Failed to update profile`, updateError);
      sendError(res, 500, updateError.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    await logAuditEvent(
      supabaseAdmin,
      req,
      {
        actorId: auth.userId,
        action: 'quota_override_change',
        resourceType: 'profile',
        resourceId: userId,
        changes: { from: previousCap, to: monthlyCap }
      },
      requestId
    );

    res.status(200).json({
      ok: true,
      updatedBy: auth.userId,
      userId,
      monthlyCap
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    console.error(`[api/admin-quota-override][${requestId}] Unhandled error`, err);
    sendError(res, 500, message, { code: 'SERVER_ERROR', requestId });
  }
};
