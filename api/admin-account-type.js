const { attachRequestId, extractBearerToken, getMissingEnv, getSupabaseAdmin, sendError, setCorsHeaders } = require('./_utils');

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
    const {
      data: { user },
      error
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return { ok: false, error: 'Unauthorized', status: 401 };
    }

    const role = typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : null;
    const accountType = typeof user.app_metadata?.account_type === 'string' ? user.app_metadata.account_type : null;
    const isAdmin = role === 'admin' || accountType === 'admin';

    if (!isAdmin) {
      return { ok: false, error: 'Forbidden', status: 403 };
    }

    return { ok: true, userId: user.id };
  } catch (error) {
    console.error(`[api/admin-account-type][${requestId}] Token validation failed`, error);
    return { ok: false, error: 'Token validation failed', status: 401 };
  }
}

async function accountTypeExists(supabaseAdmin, accountTypeId) {
  const { data, error } = await supabaseAdmin
    .from('account_types')
    .select('id')
    .eq('id', accountTypeId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data?.id);
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

  const missingEnv = getMissingEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  const supabaseAdmin = getSupabaseAdmin();
  if (missingEnv.length > 0 || !supabaseAdmin) {
    if (missingEnv.length > 0) {
      console.error(`[api/admin-account-type][${requestId}] Missing env vars: ${missingEnv.join(', ')}`);
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
  const accountTypeId = typeof req.body.accountTypeId === 'string' ? req.body.accountTypeId.trim() : '';

  if (!userId || !accountTypeId) {
    sendError(res, 400, 'userId and accountTypeId are required.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  try {
    const exists = await accountTypeExists(supabaseAdmin, accountTypeId);
    if (!exists) {
      sendError(res, 400, `Unknown account type: ${accountTypeId}`, { code: 'INVALID_REQUEST', requestId });
      return;
    }

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

    res.status(200).json({
      ok: true,
      updatedBy: auth.userId,
      userId,
      accountTypeId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    console.error(`[api/admin-account-type][${requestId}] Unhandled error`, error);
    sendError(res, 500, message, { code: 'SERVER_ERROR', requestId });
  }
};
