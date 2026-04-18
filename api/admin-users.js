const {
  attachRequestId,
  getMissingEnv,
  getSupabaseAdmin,
  log,
  sendError,
  setCorsHeaders,
  validateAdminRequest
} = require('./_utils');
const { getEffectiveMonthlyCap, getRemainingMonthlyCredits } = require('./_monthly-cap');

const MAX_PAGE_LIMIT = 100;
const DEFAULT_PAGE_LIMIT = 25;
const ADMIN_USER_LIST_SELECT_WITH_ID_TEXT =
  'id,id_text,email,auth_created_at,tier,messages_this_month,monthly_cap_override,monthly_reset_at,last_active_at,total_events';
const ADMIN_USER_LIST_SELECT_LEGACY =
  'id,email,auth_created_at,tier,messages_this_month,monthly_cap_override,monthly_reset_at,last_active_at,total_events';
const ADMIN_USER_LIST_SELECT_MINIMAL =
  'id,tier,messages_this_month,monthly_cap_override,monthly_reset_at,last_active_at,total_events';
const ADMIN_USER_LIST_SELECT_MODES = {
  FULL: 'full',
  LEGACY: 'legacy',
  MINIMAL: 'minimal'
};
let adminUserListSelectMode = ADMIN_USER_LIST_SELECT_MODES.FULL;

function isRecord(value) {
  return typeof value === 'object' && value !== null;
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

function isMissingIdTextError(error) {
  if (!isRecord(error)) {
    return false;
  }

  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return code === '42703' && message.includes('id_text');
}

function isMissingColumnError(error, columnName) {
  if (!isRecord(error)) {
    return false;
  }

  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return code === '42703' && message.includes(columnName.toLowerCase());
}

function getFallbackSelectMode(usersError, currentMode) {
  if (currentMode === ADMIN_USER_LIST_SELECT_MODES.FULL && isMissingIdTextError(usersError)) {
    return ADMIN_USER_LIST_SELECT_MODES.LEGACY;
  }

  const missingEmail =
    isMissingColumnError(usersError, 'email') || isMissingColumnError(usersError, 'auth_created_at');
  if (
    missingEmail &&
    (currentMode === ADMIN_USER_LIST_SELECT_MODES.FULL || currentMode === ADMIN_USER_LIST_SELECT_MODES.LEGACY)
  ) {
    return ADMIN_USER_LIST_SELECT_MODES.MINIMAL;
  }

  return null;
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildUsersQuery(supabaseAdmin, options) {
  const {
    tier,
    safeSearch,
    from,
    to,
    selectMode
  } = options;

  const selectedColumns =
    selectMode === ADMIN_USER_LIST_SELECT_MODES.FULL
      ? ADMIN_USER_LIST_SELECT_WITH_ID_TEXT
      : selectMode === ADMIN_USER_LIST_SELECT_MODES.LEGACY
        ? ADMIN_USER_LIST_SELECT_LEGACY
        : ADMIN_USER_LIST_SELECT_MINIMAL;

  let usersQuery = supabaseAdmin
    .from('admin_user_list')
    .select(selectedColumns, { count: 'exact' });

  if (tier) {
    usersQuery = usersQuery.eq('tier', tier);
  }

  if (safeSearch) {
    if (selectMode === ADMIN_USER_LIST_SELECT_MODES.FULL) {
      usersQuery = usersQuery.or(`email.ilike.%${safeSearch}%,id_text.ilike.%${safeSearch}%`);
    } else if (selectMode === ADMIN_USER_LIST_SELECT_MODES.LEGACY) {
      const clauses = [`email.ilike.%${safeSearch}%`];
      if (isUuidLike(safeSearch)) {
        clauses.push(`id.eq.${safeSearch}`);
      }
      usersQuery = usersQuery.or(clauses.join(','));
    } else if (isUuidLike(safeSearch)) {
      usersQuery = usersQuery.eq('id', safeSearch);
    }
  }

  const orderBy = selectMode === ADMIN_USER_LIST_SELECT_MODES.MINIMAL ? 'last_active_at' : 'auth_created_at';
  return usersQuery.order(orderBy, { ascending: false, nullsFirst: false }).range(from, to);
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

  const auth = await validateAdminRequest(supabaseAdmin, req, {
    scope: 'api/admin-users',
    requestId
  });
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
    const safeSearch = sanitizeSearchTerm(search);

    let selectMode = adminUserListSelectMode;
    let rows = null;
    let usersError = null;
    let count = null;

    while (true) {
      ({ data: rows, error: usersError, count } = await buildUsersQuery(supabaseAdmin, {
        tier,
        safeSearch,
        from,
        to,
        selectMode
      }));

      if (!usersError) {
        break;
      }

      const fallbackSelectMode = getFallbackSelectMode(usersError, selectMode);
      if (!fallbackSelectMode) {
        break;
      }

      selectMode = fallbackSelectMode;
    }

    adminUserListSelectMode = selectMode;

    if (usersError) {
      log('error', 'Failed to query admin_user_list', {
        scope: 'api/admin-users',
        requestId,
        error: usersError,
        selectMode
      });
      sendError(res, 500, 'Failed to load users.', { code: 'SERVER_ERROR', requestId });
      return;
    }

    const users = Array.isArray(rows)
      ? rows
          .filter((row) => isRecord(row) && typeof row.id === 'string')
          .map((row) => {
            const tier = typeof row.tier === 'string' ? row.tier : null;
            const messagesThisMonth = Number(row.messages_this_month ?? 0);
            const capOverride = typeof row.monthly_cap_override === 'number' ? row.monthly_cap_override : null;
            const effectiveCap = getEffectiveMonthlyCap(tier ?? 'free', capOverride);
            const remainingCredits = getRemainingMonthlyCredits(messagesThisMonth, effectiveCap);

            return {
              id: row.id,
              email: typeof row.email === 'string' ? row.email : null,
              createdAt: typeof row.auth_created_at === 'string' ? row.auth_created_at : null,
              tier,
              messagesThisMonth,
              capOverride,
              effectiveCap,
              remainingCredits,
              resetAt: typeof row.monthly_reset_at === 'string' ? row.monthly_reset_at : null,
              lastActiveAt: typeof row.last_active_at === 'string' ? row.last_active_at : null,
              totalEvents: Number(row.total_events ?? 0)
            };
          })
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
    log('error', 'Unhandled error', {
      scope: 'api/admin-users',
      requestId,
      error: err
    });
    sendError(res, 500, 'Failed to load users.', { code: 'SERVER_ERROR', requestId });
  }
};
