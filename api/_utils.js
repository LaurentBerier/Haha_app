const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

let supabaseAdminCache = undefined;

function parseAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isWildcardLocalhostMatch(origin, allowedOrigin) {
  if (allowedOrigin !== 'http://localhost:*' && allowedOrigin !== 'https://localhost:*' && allowedOrigin !== 'http://127.0.0.1:*' && allowedOrigin !== 'https://127.0.0.1:*') {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    const allowedUrl = new URL(allowedOrigin.replace(':*', ':1'));
    return originUrl.protocol === allowedUrl.protocol && originUrl.hostname === allowedUrl.hostname;
  } catch {
    return false;
  }
}

function isOriginAllowed(origin, allowedOrigins) {
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  return allowedOrigins.some((allowedOrigin) => isWildcardLocalhostMatch(origin, allowedOrigin));
}

function setCorsHeaders(req, res, options = {}) {
  const methods = options.methods ?? 'POST, OPTIONS';
  const headers = options.headers ?? 'Content-Type, Authorization';
  const allowMissingOrigin = options.allowMissingOrigin === true;
  const origin = req.headers.origin;
  const allowedOrigins = parseAllowedOrigins();

  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);

  // Non-browser callers may omit Origin. Browsers generally send Fetch Metadata;
  // reject those when Origin is missing to avoid browser CORS bypass patterns.
  if (!origin) {
    const hasFetchMetadata =
      typeof req.headers['sec-fetch-mode'] === 'string' ||
      typeof req.headers['sec-fetch-site'] === 'string' ||
      typeof req.headers['sec-fetch-dest'] === 'string';

    if (hasFetchMetadata) {
      return { ok: false, reason: 'origin_required' };
    }

    if (allowMissingOrigin) {
      return { ok: true, reason: null };
    }

    const bearer = extractBearerToken(req.headers.authorization);
    if (bearer) {
      return { ok: true, reason: null };
    }

    return { ok: false, reason: 'origin_required' };
  }

  // Always allow same-origin calls (web app and API served from the same host).
  const forwardedHostRaw = req.headers['x-forwarded-host'];
  const forwardedHost = Array.isArray(forwardedHostRaw) ? forwardedHostRaw[0] : forwardedHostRaw;
  const host = typeof forwardedHost === 'string' && forwardedHost.trim()
    ? forwardedHost.trim()
    : typeof req.headers.host === 'string' && req.headers.host.trim()
      ? req.headers.host.trim()
      : '';

  if (host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        return { ok: true, reason: null };
      }
    } catch {
      // Ignore malformed Origin and continue with explicit allow-list checks.
    }
  }

  if (allowedOrigins.length === 0) {
    return { ok: false, reason: 'cors_not_configured' };
  }

  if (!isOriginAllowed(origin, allowedOrigins)) {
    return { ok: false, reason: 'origin_not_allowed' };
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  return { ok: true, reason: null };
}

function extractBearerToken(header) {
  return typeof header === 'string' ? header.replace(/^Bearer\s+/i, '').trim() : '';
}

function getMissingEnv(names) {
  return names.filter((name) => {
    const value = process.env[name];
    return typeof value !== 'string' || !value.trim();
  });
}

function attachRequestId(req, res) {
  const incoming = req.headers['x-request-id'];
  const raw = Array.isArray(incoming) ? incoming[0] : incoming;
  const requestId = typeof raw === 'string' && raw.trim() ? raw.trim() : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  return requestId;
}

function getSupabaseAdmin() {
  if (supabaseAdminCache !== undefined) {
    return supabaseAdminCache;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    typeof supabaseUrl === 'string' &&
    supabaseUrl &&
    typeof serviceRoleKey === 'string' &&
    serviceRoleKey
  ) {
    supabaseAdminCache = createClient(supabaseUrl, serviceRoleKey);
    return supabaseAdminCache;
  }

  supabaseAdminCache = null;
  return supabaseAdminCache;
}

function sendError(res, status, message, options = {}) {
  const payload = {
    error: {
      message
    }
  };

  if (typeof options.code === 'string' && options.code) {
    payload.error.code = options.code;
  }

  if (typeof options.requestId === 'string' && options.requestId) {
    payload.error.requestId = options.requestId;
  }

  res.status(status).json(payload);
}

function getClientIp(req) {
  const forwardedFor = req && req.headers ? req.headers['x-forwarded-for'] : null;
  const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',')[0]?.trim() ?? null;
  }
  return null;
}

async function logAuditEvent(supabaseAdmin, req, entry, requestId) {
  if (!supabaseAdmin || !entry || typeof entry.action !== 'string' || !entry.action) {
    return;
  }

  const payload = {
    actor_id: typeof entry.actorId === 'string' && entry.actorId ? entry.actorId : null,
    action: entry.action,
    resource_type: typeof entry.resourceType === 'string' && entry.resourceType ? entry.resourceType : null,
    resource_id: typeof entry.resourceId === 'string' && entry.resourceId ? entry.resourceId : null,
    changes: entry.changes && typeof entry.changes === 'object' ? entry.changes : null,
    ip_address: getClientIp(req)
  };

  try {
    const { error } = await supabaseAdmin.from('audit_logs').insert(payload);
    if (error) {
      console.error(`[api/audit][${requestId}] Failed to write audit log`, error);
    }
  } catch (error) {
    // Best-effort: do not break primary request path if audit table isn't available yet.
    console.error(`[api/audit][${requestId}] Failed to write audit log`, error);
  }
}

module.exports = {
  setCorsHeaders,
  extractBearerToken,
  getMissingEnv,
  attachRequestId,
  sendError,
  getSupabaseAdmin,
  logAuditEvent
};
