const { attachRequestId, extractBearerToken, getMissingEnv, getSupabaseAdmin, sendError, setCorsHeaders } = require('./_utils');

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
    console.error(`[api/admin-users][${requestId}] Token validation failed`, err);
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
  const search = typeof query?.search === 'string' && query.search.trim() ? query.search.trim().toLowerCase() : null;

  return { page, limit, tier, search };
}

async function listAllAuthUsers(supabaseAdmin, perPage = MAX_PAGE_LIMIT) {
  const users = [];
  let page = 1;
  let total = null;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage
    });

    if (error) {
      return { users: [], total: 0, error };
    }

    const batch = Array.isArray(data?.users) ? data.users : [];
    users.push(...batch);

    if (typeof data?.total === 'number') {
      total = data.total;
    }

    if (batch.length === 0 || (typeof total === 'number' && users.length >= total)) {
      break;
    }

    page += 1;
  }

  return { users, total: total ?? users.length, error: null };
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
      console.error(`[api/admin-users][${requestId}] Missing env vars: ${missingEnv.join(', ')}`);
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
    // Fetch all auth users first so search/tier filters work across the full dataset.
    const { users: allAuthUsers, error: authError } = await listAllAuthUsers(supabaseAdmin);
    if (authError) {
      console.error(`[api/admin-users][${requestId}] Failed to list auth users`, authError);
      sendError(res, 500, authError.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    // Apply email search filter client-side (auth.admin.listUsers has no server-side search)
    let authUsers = allAuthUsers;
    if (search) {
      authUsers = authUsers.filter((u) =>
        (typeof u.email === 'string' && u.email.toLowerCase().includes(search)) ||
        u.id.toLowerCase().includes(search)
      );
    }

    if (authUsers.length === 0) {
      res.status(200).json({ ok: true, users: [], total: 0, page, limit });
      return;
    }

    const userIds = authUsers.map((u) => u.id);

    // Fetch profile data from the admin_user_list view for these users
    let profileQuery = supabaseAdmin
      .from('admin_user_list')
      .select('*')
      .in('id', userIds);

    if (tier) {
      profileQuery = profileQuery.eq('tier', tier);
    }

    const { data: profileRows, error: profileError } = await profileQuery;

    if (profileError) {
      console.error(`[api/admin-users][${requestId}] Failed to query admin_user_list`, profileError);
      sendError(res, 500, profileError.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    // Build a lookup map from profile rows
    const profileMap = new Map();
    for (const row of (profileRows ?? [])) {
      if (isRecord(row) && typeof row.id === 'string') {
        profileMap.set(row.id, row);
      }
    }

    // Merge auth + profile data, skipping users filtered out by tier
    const filteredUsers = authUsers
      .filter((u) => {
        if (!tier) {
          return true;
        }
        const profile = profileMap.get(u.id);
        return profile && profile.tier === tier;
      })
      .map((u) => {
        const profile = profileMap.get(u.id);
        return {
          id: u.id,
          email: typeof u.email === 'string' ? u.email : null,
          createdAt: typeof u.created_at === 'string' ? u.created_at : null,
          tier: profile ? (profile.tier ?? null) : null,
          messagesThisMonth: profile ? Number(profile.messages_this_month ?? 0) : 0,
          capOverride: profile && typeof profile.monthly_cap_override === 'number'
            ? profile.monthly_cap_override
            : null,
          resetAt: profile ? (profile.monthly_reset_at ?? null) : null,
          lastActiveAt: profile ? (profile.last_active_at ?? null) : null,
          totalEvents: profile ? Number(profile.total_events ?? 0) : 0
        };
      });

    const total = filteredUsers.length;
    const start = page * limit;
    const users = filteredUsers.slice(start, start + limit);

    res.status(200).json({
      ok: true,
      users,
      total,
      page,
      limit
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    console.error(`[api/admin-users][${requestId}] Unhandled error`, err);
    sendError(res, 500, message, { code: 'SERVER_ERROR', requestId });
  }
};
