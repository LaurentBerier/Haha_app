const { attachRequestId, extractBearerToken, getMissingEnv, getSupabaseAdmin, sendError, setCorsHeaders } = require('./_utils');

function isMissingDeleteAccountRpc(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = typeof error.code === 'string' ? error.code : '';
  if (code === 'PGRST202' || code === '42883') {
    return true;
  }

  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return message.includes('delete_account_cascade') && (message.includes('not found') || message.includes('could not find'));
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

  const missingEnv = getMissingEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (missingEnv.length > 0 || !supabaseAdmin) {
    if (missingEnv.length > 0) {
      console.error(`[api/delete-account][${requestId}] Missing env vars: ${missingEnv.join(', ')}`);
    }
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    sendError(res, 401, 'Missing bearer token.', { code: 'UNAUTHORIZED', requestId });
    return;
  }

  try {
    const {
      data: { user },
      error: getUserError
    } = await supabaseAdmin.auth.getUser(token);

    if (getUserError || !user) {
      sendError(res, 401, 'Unauthorized.', { code: 'UNAUTHORIZED', requestId });
      return;
    }

    const { error: cleanupError } = await supabaseAdmin.rpc('delete_account_cascade', {
      p_user_id: user.id,
      p_request_id: requestId
    });
    if (cleanupError) {
      if (isMissingDeleteAccountRpc(cleanupError)) {
        console.error(`[api/delete-account][${requestId}] delete_account_cascade RPC missing`, cleanupError);
        sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
        return;
      }

      console.error(`[api/delete-account][${requestId}] delete_account_cascade failed`, cleanupError);
      sendError(res, 500, 'Failed to clean account data before auth deletion.', { code: 'SERVER_ERROR', requestId });
      return;
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      sendError(res, 500, deleteError.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    res.status(200).json({ ok: true, deletedUserId: user.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    console.error(`[api/delete-account][${requestId}] Unhandled error`, error);
    sendError(res, 500, message, { code: 'SERVER_ERROR', requestId });
  }
};
