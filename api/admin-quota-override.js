const {
  attachRequestId,
  getMissingEnv,
  getSupabaseAdmin,
  logAuditEvent,
  sendError,
  setCorsHeaders,
  validateAdminRequest
} = require('./_utils');

function isRecord(value) {
  return typeof value === 'object' && value !== null;
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

  const auth = await validateAdminRequest(supabaseAdmin, req, {
    scope: 'api/admin-quota-override',
    requestId
  });
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
      sendError(res, 500, 'Failed to update quota override.', { code: 'SERVER_ERROR', requestId });
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
    console.error(`[api/admin-quota-override][${requestId}] Unhandled error`, err);
    sendError(res, 500, 'Failed to update quota override.', { code: 'SERVER_ERROR', requestId });
  }
};
