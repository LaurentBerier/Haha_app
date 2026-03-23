const {
  attachRequestId,
  extractBearerToken,
  getMissingEnv,
  getSupabaseAdmin,
  log,
  sendError,
  setCorsHeaders
} = require('./_utils');

const MAX_PAGE_LIMIT = 100;
const DEFAULT_PAGE_LIMIT = 25;

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
    log('error', 'Token validation failed', {
      scope: 'api/admin-users',
      requestId,
      error: err
    });
    return { ok: false, error: 'Token validation failed', status: 401 };
  }
}

function parsePageParams(query) {
  const rawPage = parseInt(query?.page ?? '0', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;

  const rawLimit = parseInt(query?.limit ?? String(DEFAULT_PAGE_LIMIT), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;

  const tier = typeof query?.tier === 'string' && query.tier ? query.tier : null;
  const search = typeof query?.search === 'string' && query.search.trim() ? query.search.trim() : null;

  return { page, limit, tier, search };
}

function sanitizeSearchTerm(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/[,%()']/g, ' ').trim();
}

module.exports = async function handler(req, res) {
  const requestId = attachRequestId(req, res);
  const corsResult = setCorsHeaders(req, res, { methods: 'GET, OPTIONS' });
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

  if (req.method !== 'GET') {
    sendError(res, 405, 'Method not allowed.', { code: 'METHOD_NOT_ALLOWED', requestId });
    return;
  }

  const missingEnv = getMissingEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  const supabaseAdmin = getSupabaseAdmin();
  if (missingEnv.length > 0 || !supabaseAdmin) {
    if (missingEnv.length > 0) {
      log('error', 'Missing environment variables', {
        scope: 'api/admin-users',
        requestId,
        missingEnv
      });
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

  const { page, limit, tier, search } = parsePageParams(req.query);

  try {
    const from = page * limit;
    const to = from + limit - 1;
    let usersQuery = supabaseAdmin
      .from('admin_user_list')
      .select(
        'id,id_text,email,auth_created_at,tier,messages_this_month,monthly_cap_override,monthly_reset_at,last_active_at,total_events',
        { count: 'exact' }
      );

    if (tier) {
      usersQuery = usersQuery.eq('tier', tier);
    }

    const safeSearch = sanitizeSearchTerm(search);
    if (safeSearch) {
      usersQuery = usersQuery.or(`email.ilike.%${safeSearch}%,id_text.ilike.%${safeSearch}%`);
    }

    usersQuery = usersQuery.order('auth_created_at', { ascending: false, nullsFirst: false }).range(from, to);
    const { data: rows, error: usersError, count } = await usersQuery;
    if (usersError) {
      log('error', 'Failed to query admin_user_list', {
        scope: 'api/admin-users',
        requestId,
        error: usersError
      });
      sendError(res, 500, usersError.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    const users = Array.isArray(rows)
      ? rows
          .filter((row) => isRecord(row) && typeof row.id === 'string')
          .map((row) => ({
            id: row.id,
            email: typeof row.email === 'string' ? row.email : null,
            createdAt: typeof row.auth_created_at === 'string' ? row.auth_created_at : null,
            tier: typeof row.tier === 'string' ? row.tier : null,
            messagesThisMonth: Number(row.messages_this_month ?? 0),
            capOverride: typeof row.monthly_cap_override === 'number' ? row.monthly_cap_override : null,
            resetAt: typeof row.monthly_reset_at === 'string' ? row.monthly_reset_at : null,
            lastActiveAt: typeof row.last_active_at === 'string' ? row.last_active_at : null,
            totalEvents: Number(row.total_events ?? 0)
          }))
      : [];

    const total = typeof count === 'number' ? count : users.length;

    res.status(200).json({
      ok: true,
      users,
      total,
      page,
      limit
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    log('error', 'Unhandled error', {
      scope: 'api/admin-users',
      requestId,
      error: err
    });
    sendError(res, 500, message, { code: 'SERVER_ERROR', requestId });
  }
};
