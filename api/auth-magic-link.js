const { createClient } = require('@supabase/supabase-js');
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
const FALLBACK_CALLBACK_URL = 'hahaha://auth/callback';
const NEUTRAL_RESPONSE_MESSAGE = "Si l'email est valide, un lien de connexion a ete envoye.";

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

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function isValidIntent(value) {
  return value === 'signin' || value === 'signup';
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
  const intent = typeof req.body.intent === 'string' ? req.body.intent.trim().toLowerCase() : '';
  if (!isValidEmail(email)) {
    sendError(res, 400, 'Valid email is required.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  if (!isValidIntent(intent)) {
    sendError(res, 400, 'intent must be signin or signup.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  const supabasePublic = getSupabasePublicClient();
  if (!supabasePublic) {
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const emailRedirectTo = resolveEmailRedirectTo(req.headers.origin);
  try {
    const { error } = await supabasePublic.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo,
        shouldCreateUser: intent === 'signup'
      }
    });

    if (error) {
      log('warn', 'Supabase signInWithOtp returned error for auth magic-link endpoint', {
        scope: 'api/auth-magic-link',
        requestId,
        intent,
        emailDomain: email.split('@')[1] ?? '',
        error: {
          message: error.message,
          name: error.name
        },
        // Keep a neutral response body to avoid account enumeration.
        capture: false
      });
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
