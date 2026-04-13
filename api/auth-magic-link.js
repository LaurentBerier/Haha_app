const { createHash } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { kv } = require('@vercel/kv');
const {
  attachRequestId,
  checkIpRateLimit,
  getMissingEnv,
  log,
  sendError,
  setCorsHeaders
} = require('./_utils');

const DEFAULT_MAX_REQUESTS = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_EMAIL_MAX_REQUESTS = 5;
const DEFAULT_EMAIL_WINDOW_MS = 15 * 60 * 1000;
const FALLBACK_CALLBACK_URL = 'hahaha://auth/callback';
const NEUTRAL_RESPONSE_MESSAGE = "Si l'email est valide, un lien de connexion a ete envoye.";
const PROVIDER_ERROR_MESSAGE = "Impossible d'envoyer le lien de connexion pour le moment.";

let supabasePublicClientCache = undefined;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function hashNormalizedEmail(email) {
  return createHash('sha256').update(email).digest('hex');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function isValidIntent(value) {
  return value === 'auto' || value === 'signin' || value === 'signup';
}

function isValidEmail(value) {
  if (!value) {
    return false;
  }
  // Pragmatic email syntax check (backend still delegates canonical validation to Supabase).
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function resolveEmailRedirectTo(originHeaderValue) {
  if (typeof originHeaderValue !== 'string' || !originHeaderValue.trim()) {
    return FALLBACK_CALLBACK_URL;
  }

  try {
    const originUrl = new URL(originHeaderValue.trim());
    if (originUrl.protocol !== 'https:' && originUrl.protocol !== 'http:') {
      return FALLBACK_CALLBACK_URL;
    }
    const normalizedOrigin = `${originUrl.protocol}//${originUrl.host}`.replace(/\/+$/, '');
    return `${normalizedOrigin}/auth/callback`;
  } catch {
    return FALLBACK_CALLBACK_URL;
  }
}

function parseFiniteNonNegativeInt(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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

function shouldBypassRateLimitWhenKvUnavailable() {
  if (process.env.DISABLE_IP_RATE_LIMIT === 'true') {
    return true;
  }
  return process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';
}

function buildEmailRateLimitKey(emailHash, bucketSizeMs, bucketIndex) {
  return `auth_magic_link_email:${bucketSizeMs}:${emailHash}:${bucketIndex}`;
}

async function checkEmailRateLimit(emailHash, options = {}) {
  const windowMs = parsePositiveInt(options.windowMs, DEFAULT_EMAIL_WINDOW_MS);
  const maxRequests = parsePositiveInt(options.maxRequests, DEFAULT_EMAIL_MAX_REQUESTS);
  const requestId = typeof options.requestId === 'string' && options.requestId ? options.requestId : 'unknown';

  if (!isKvEnvironmentConfigured()) {
    if (shouldBypassRateLimitWhenKvUnavailable()) {
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
  const currentBucket = Math.floor(nowMs / windowMs);
  const bucketProgressRatio = (nowMs % windowMs) / windowMs;
  const currentKey = buildEmailRateLimitKey(emailHash, windowMs, currentBucket);
  const previousKey = buildEmailRateLimitKey(emailHash, windowMs, currentBucket - 1);

  try {
    const currentCount = await kv.incr(currentKey);
    if (currentCount === 1) {
      const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000) + 30);
      await kv.expire(currentKey, ttlSeconds);
    }

    const previousRaw = await kv.get(previousKey);
    const previousCount = parseFiniteNonNegativeInt(previousRaw) ?? 0;
    const effectiveCount = currentCount + previousCount * (1 - bucketProgressRatio);

    if (effectiveCount > maxRequests) {
      return {
        ok: false,
        status: 429,
        code: 'EMAIL_RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded.',
        retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000))
      };
    }

    return { ok: true, retryAfterSeconds: 0 };
  } catch (error) {
    log('error', 'Email rate limit check failed', {
      scope: 'api/auth-magic-link',
      requestId,
      emailHashPrefix: emailHash.slice(0, 12),
      error: error instanceof Error ? { name: error.name, message: error.message } : error
    });
    if (shouldBypassRateLimitWhenKvUnavailable()) {
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

function isLegacySigninAccountStateError(intent, error) {
  if (intent !== 'signin' || !error || typeof error !== 'object') {
    return false;
  }

  const withDetails = error;
  const code = typeof withDetails.code === 'string' ? withDetails.code.toLowerCase() : '';
  const message = typeof withDetails.message === 'string' ? withDetails.message.toLowerCase() : '';

  if (code === 'otp_disabled' || code === 'user_not_found') {
    return true;
  }

  return message.includes('signups not allowed for otp') || message.includes('user not found');
}

function getSupabasePublicClient() {
  if (supabasePublicClientCache !== undefined) {
    return supabasePublicClientCache;
  }

  const supabaseUrl = typeof process.env.SUPABASE_URL === 'string' ? process.env.SUPABASE_URL.trim() : '';
  const supabaseAnonKey = typeof process.env.SUPABASE_ANON_KEY === 'string' ? process.env.SUPABASE_ANON_KEY.trim() : '';
  if (!supabaseUrl || !supabaseAnonKey) {
    supabasePublicClientCache = null;
    return supabasePublicClientCache;
  }

  supabasePublicClientCache = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });

  return supabasePublicClientCache;
}

module.exports = async function handler(req, res) {
  const requestId = attachRequestId(req, res);
  const corsResult = setCorsHeaders(req, res, {
    methods: 'POST, OPTIONS',
    allowMissingOrigin: true
  });

  if (!corsResult.ok) {
    if (corsResult.reason === 'cors_not_configured') {
      sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
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

  const missingEnv = getMissingEnv(['SUPABASE_URL', 'SUPABASE_ANON_KEY']);
  if (missingEnv.length > 0) {
    log('error', 'Missing environment variables for auth magic-link endpoint', {
      scope: 'api/auth-magic-link',
      requestId,
      missingEnv
    });
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const maxRequests = parsePositiveInt(process.env.AUTH_MAGIC_LINK_MAX_REQUESTS, DEFAULT_MAX_REQUESTS);
  const windowMs = parsePositiveInt(process.env.AUTH_MAGIC_LINK_WINDOW_MS, DEFAULT_WINDOW_MS);
  const ipRateLimit = await checkIpRateLimit(req, { requestId, maxRequests, windowMs });
  if (!ipRateLimit.ok) {
    if (ipRateLimit.retryAfterSeconds > 0) {
      res.setHeader('Retry-After', String(ipRateLimit.retryAfterSeconds));
    }
    sendError(res, ipRateLimit.status, ipRateLimit.message, {
      code: ipRateLimit.code,
      requestId
    });
    return;
  }

  if (!isRecord(req.body)) {
    sendError(res, 400, 'JSON body is required.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  const email = normalizeEmail(req.body.email);
  const rawIntent = typeof req.body.intent === 'string' ? req.body.intent.trim().toLowerCase() : '';
  const intent = rawIntent || 'auto';
  if (!isValidEmail(email)) {
    sendError(res, 400, 'Valid email is required.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  if (!isValidIntent(intent)) {
    sendError(res, 400, 'intent must be auto, signin or signup.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  const supabasePublic = getSupabasePublicClient();
  if (!supabasePublic) {
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const normalizedEmailHash = hashNormalizedEmail(email);
  const emailRateLimit = await checkEmailRateLimit(normalizedEmailHash, {
    requestId,
    maxRequests: parsePositiveInt(process.env.AUTH_MAGIC_LINK_EMAIL_MAX_REQUESTS, DEFAULT_EMAIL_MAX_REQUESTS),
    windowMs: parsePositiveInt(process.env.AUTH_MAGIC_LINK_EMAIL_WINDOW_MS, DEFAULT_EMAIL_WINDOW_MS)
  });
  if (!emailRateLimit.ok) {
    if (emailRateLimit.retryAfterSeconds > 0) {
      res.setHeader('Retry-After', String(emailRateLimit.retryAfterSeconds));
    }
    sendError(res, emailRateLimit.status, emailRateLimit.message, {
      code: emailRateLimit.code,
      requestId
    });
    return;
  }

  const emailRedirectTo = resolveEmailRedirectTo(req.headers.origin);
  try {
    const { error } = await supabasePublic.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo,
        shouldCreateUser: intent !== 'signin'
      }
    });

    if (error) {
      log('warn', 'Supabase signInWithOtp returned error for auth magic-link endpoint', {
        scope: 'api/auth-magic-link',
        requestId,
        intent,
        emailHashPrefix: normalizedEmailHash.slice(0, 12),
        error: {
          message: error.message,
          name: error.name,
          code: typeof error.code === 'string' ? error.code : null
        },
        capture: false
      });

      if (isLegacySigninAccountStateError(intent, error)) {
        res.status(200).json({
          ok: true,
          message: NEUTRAL_RESPONSE_MESSAGE
        });
        return;
      }

      sendError(res, 500, PROVIDER_ERROR_MESSAGE, {
        code: 'AUTH_PROVIDER_ERROR',
        requestId,
        capture: false
      });
      return;
    }

    res.status(200).json({
      ok: true,
      message: NEUTRAL_RESPONSE_MESSAGE
    });
  } catch (error) {
    log('error', 'Unhandled error in auth magic-link endpoint', {
      scope: 'api/auth-magic-link',
      requestId,
      error
    });
    sendError(res, 500, 'Server error.', { code: 'SERVER_ERROR', requestId });
  }
};
