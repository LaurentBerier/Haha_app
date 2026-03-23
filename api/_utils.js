const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { kv } = require('@vercel/kv');
const { captureApiException } = require('./_sentry');

let supabaseAdminCache = undefined;
const RATE_LIMIT_BUCKET_MS = 60_000;
const DEFAULT_IP_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_IP_RATE_LIMIT_MAX_REQUESTS = 100;

function parseAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeOriginValue(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.includes('://*.') || trimmed.endsWith(':*')) {
    return trimmed.toLowerCase();
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  try {
    const parsed = new URL(withoutTrailingSlash);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return withoutTrailingSlash.toLowerCase();
  }
}

function parseHostCandidates(rawValue) {
  const asString = Array.isArray(rawValue) ? rawValue.join(',') : rawValue;
  if (typeof asString !== 'string' || !asString.trim()) {
    return [];
  }

  return asString
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .flatMap((value) => {
      const next = [value];
      try {
        const parsed = new URL(`https://${value}`);
        if (parsed.host) {
          next.push(parsed.host.toLowerCase());
        }
        if (parsed.hostname) {
          next.push(parsed.hostname.toLowerCase());
        }
      } catch {
        // Ignore malformed host fragments.
      }
      return next;
    });
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

function isWildcardSubdomainMatch(origin, allowedOrigin) {
  if (typeof allowedOrigin !== 'string' || !allowedOrigin.includes('://*.')) {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    const allowedUrl = new URL(allowedOrigin.replace('://*.', '://'));
    if (originUrl.protocol !== allowedUrl.protocol) {
      return false;
    }

    const baseDomain = allowedUrl.hostname.toLowerCase();
    const originHostname = originUrl.hostname.toLowerCase();
    return originHostname === baseDomain || originHostname.endsWith(`.${baseDomain}`);
  } catch {
    return false;
  }
}

function isOriginAllowed(origin, allowedOrigins) {
  const normalizedOrigin = normalizeOriginValue(origin);
  const normalizedAllowedOrigins = allowedOrigins.map((entry) => normalizeOriginValue(entry)).filter(Boolean);

  if (normalizedAllowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  return normalizedAllowedOrigins.some(
    (allowedOrigin) =>
      isWildcardLocalhostMatch(normalizedOrigin, allowedOrigin) ||
      isWildcardSubdomainMatch(normalizedOrigin, allowedOrigin)
  );
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
    const fetchSite = typeof req.headers['sec-fetch-site'] === 'string'
      ? req.headers['sec-fetch-site'].trim().toLowerCase()
      : '';
    const hasFetchMetadata =
      typeof req.headers['sec-fetch-mode'] === 'string' ||
      typeof req.headers['sec-fetch-site'] === 'string' ||
      typeof req.headers['sec-fetch-dest'] === 'string';

    if (hasFetchMetadata) {
      // Same-origin browser requests may omit Origin.
      if (fetchSite === 'same-origin') {
        return { ok: true, reason: null };
      }
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
  const hostCandidates = [
    ...parseHostCandidates(req.headers['x-forwarded-host']),
    ...parseHostCandidates(req.headers.host)
  ];

  if (hostCandidates.length > 0) {
    try {
      const originUrl = new URL(origin);
      const originCandidates = [originUrl.host.toLowerCase(), originUrl.hostname.toLowerCase()];
      if (originCandidates.some((candidate) => hostCandidates.includes(candidate))) {
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

  if (status >= 500 && options.capture !== false) {
    const sentryError = Object.prototype.hasOwnProperty.call(options, 'error') ? options.error : message;
    captureApiException(sentryError, {
      message,
      requestId: typeof options.requestId === 'string' ? options.requestId : undefined,
      scope: typeof options.scope === 'string' && options.scope ? options.scope : 'api/send-error',
      extra: {
        code: typeof options.code === 'string' ? options.code : undefined,
        status
      }
    });
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

function shouldBypassIpRateLimitWhenKvUnavailable() {
  return process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFiniteNonNegativeInt(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildIpRateLimitKey(ipAddress, minuteBucket) {
  return `ip_ratelimit:${ipAddress}:${minuteBucket}`;
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  if (error && typeof error === 'object') {
    return error;
  }

  return {
    message: String(error)
  };
}

function normalizeLogContext(context) {
  if (!context || typeof context !== 'object') {
    return {};
  }
  return context;
}

function toCaptureErrorCandidate(candidate, fallbackMessage) {
  if (candidate instanceof Error) {
    return candidate;
  }

  if (candidate && typeof candidate === 'object') {
    const message = typeof candidate.message === 'string' && candidate.message.trim()
      ? candidate.message
      : fallbackMessage;
    const revived = new Error(message);
    if (typeof candidate.name === 'string' && candidate.name.trim()) {
      revived.name = candidate.name;
    }
    if (typeof candidate.stack === 'string' && candidate.stack.trim()) {
      revived.stack = candidate.stack;
    }
    return revived;
  }

  if (typeof candidate === 'string' && candidate.trim()) {
    return new Error(candidate);
  }

  return new Error(fallbackMessage);
}

function log(level, message, context = {}) {
  const normalizedContext = normalizeLogContext(context);
  const normalizedLevel = level === 'debug' || level === 'info' || level === 'warn' || level === 'error'
    ? level
    : 'info';
  const payload = {
    ts: new Date().toISOString(),
    level: normalizedLevel,
    message,
    ...normalizedContext
  };

  if (normalizedLevel === 'error') {
    const shouldCapture = normalizedContext.capture !== false;
    if (shouldCapture) {
      const fallbackError =
        Object.prototype.hasOwnProperty.call(normalizedContext, 'error')
          ? normalizedContext.error
          : null;
      captureApiException(toCaptureErrorCandidate(fallbackError, message), {
        message,
        requestId: payload.requestId,
        scope: payload.scope,
        extra: payload
      });
    }
    console.error(payload);
    return;
  }

  if (normalizedLevel === 'warn') {
    console.warn(payload);
    return;
  }

  console.log(payload);
}

/**
 * Enforce a cross-instance IP-based sliding-window rate limit using Vercel KV.
 *
 * @param {object} req Incoming HTTP request object.
 * @param {object} options Rate-limit options.
 * @param {number} [options.maxRequests=100] Maximum allowed requests in the window.
 * @param {number} [options.windowMs=60000] Sliding window size in milliseconds.
 * @param {string} [options.requestId='unknown'] Correlation id for logs/errors.
 * @returns {Promise<{ok: boolean, status?: number, code?: string, message?: string, retryAfterSeconds: number}>}
 */
async function checkIpRateLimit(req, options = {}) {
  const windowMs = parsePositiveInt(options.windowMs, DEFAULT_IP_RATE_LIMIT_WINDOW_MS);
  const maxRequests = parsePositiveInt(options.maxRequests, DEFAULT_IP_RATE_LIMIT_MAX_REQUESTS);
  const requestId = typeof options.requestId === 'string' && options.requestId ? options.requestId : 'unknown';
  const ipAddress = getClientIp(req);

  if (!ipAddress) {
    return { ok: true, retryAfterSeconds: 0 };
  }

  if (!isKvEnvironmentConfigured()) {
    if (shouldBypassIpRateLimitWhenKvUnavailable()) {
      return { ok: true, retryAfterSeconds: 0 };
    }
    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Rate limit store unavailable.',
      retryAfterSeconds: 0
    };
  }

  const nowMs = Date.now();
  const currentMinute = Math.floor(nowMs / RATE_LIMIT_BUCKET_MS);
  const minuteProgressRatio = (nowMs % RATE_LIMIT_BUCKET_MS) / RATE_LIMIT_BUCKET_MS;
  const currentKey = buildIpRateLimitKey(ipAddress, currentMinute);
  const previousKey = buildIpRateLimitKey(ipAddress, currentMinute - 1);

  try {
    const currentCount = await kv.incr(currentKey);
    if (currentCount === 1) {
      const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000) + 30);
      await kv.expire(currentKey, ttlSeconds);
    }

    const previousRaw = await kv.get(previousKey);
    const previousCount = parseFiniteNonNegativeInt(previousRaw) ?? 0;
    const effectiveCount = currentCount + previousCount * (1 - minuteProgressRatio);

    if (effectiveCount > maxRequests) {
      return {
        ok: false,
        status: 429,
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded.',
        retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000))
      };
    }

    return { ok: true, retryAfterSeconds: 0 };
  } catch (error) {
    log('error', 'IP rate limit check failed', {
      scope: 'api/rate-limit',
      requestId,
      ipAddress,
      error: serializeError(error)
    });
    if (shouldBypassIpRateLimitWhenKvUnavailable()) {
      return { ok: true, retryAfterSeconds: 0 };
    }
    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Rate limit store unavailable.',
      retryAfterSeconds: 0
    };
  }
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
      log('error', 'Failed to write audit log', {
        scope: 'api/audit',
        requestId,
        error: serializeError(error)
      });
    }
  } catch (error) {
    // Best-effort: do not break primary request path if audit table isn't available yet.
    log('error', 'Failed to write audit log', {
      scope: 'api/audit',
      requestId,
      error: serializeError(error)
    });
  }
}

module.exports = {
  setCorsHeaders,
  extractBearerToken,
  getMissingEnv,
  attachRequestId,
  sendError,
  getSupabaseAdmin,
  getClientIp,
  checkIpRateLimit,
  logAuditEvent,
  log
};
