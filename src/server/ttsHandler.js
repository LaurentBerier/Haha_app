const {
  attachRequestId,
  checkIpRateLimit,
  extractBearerToken,
  getMissingEnv,
  getSupabaseAdmin,
  sendError,
  setCorsHeaders
} = require('../../api/_utils');
const {
  normalizeAccountType,
  resolveEffectiveAccountType: resolveAccountTypeByRole
} = require('../../api/_account-tier');

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE_ID_GENERIC = 'cgSgspJ2msm6clMCkdW9';
const DEFAULT_MODEL_ID = 'eleven_v3';
const DEFAULT_TTS_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_TTS_RATE_LIMIT_MAX_REQUESTS = 20;
const DEFAULT_TTS_RATE_LIMIT_MAX_REQUESTS_BY_TIER = {
  free: 20,
  regular: 60,
  premium: 180,
  admin: 600
};
const MAX_INPUT_TEXT_CHARS = 5_000;
const MAX_PROVIDER_TEXT_CHARS = 1_000;
const DEFAULT_TTS_CAPS = {
  free: 200_000,
  regular: 2_000,
  premium: 20_000
};

const ELEVENLABS_LANGUAGE_CODES = new Set([
  'ar',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'fi',
  'fr',
  'hi',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'nl',
  'no',
  'pl',
  'pt',
  'ro',
  'ru',
  'sv',
  'tr',
  'uk',
  'vi',
  'zh'
]);

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readFirstNonEmptyEnv(...keys) {
  for (const key of keys) {
    if (!key) {
      continue;
    }
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function parseBooleanEnv(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}

function getMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function getTtsMonthlyCap(accountType) {
  const normalized = normalizeAccountType(accountType);
  const envKey = `TTS_MONTHLY_CAP_${normalized.toUpperCase()}`;
  const fromEnv = parsePositiveInt(process.env[envKey], 0);
  if (fromEnv > 0) {
    return fromEnv;
  }

  if (normalized === 'admin') {
    return null;
  }

  const cap = DEFAULT_TTS_CAPS[normalized];
  return typeof cap === 'number' ? cap : null;
}

function resolveVoiceIdForTier(accountType) {
  const genericVoiceId =
    readFirstNonEmptyEnv('ELEVENLABS_VOICE_ID_GENERIC', 'EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC') ||
    DEFAULT_VOICE_ID_GENERIC;
  const cathyVoiceId = readFirstNonEmptyEnv('ELEVENLABS_VOICE_ID_CATHY', 'EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY');
  const regularVoiceOverride = readFirstNonEmptyEnv('ELEVENLABS_VOICE_ID_REGULAR');
  const premiumVoiceOverride = readFirstNonEmptyEnv('ELEVENLABS_VOICE_ID_PREMIUM');
  const useCathyForAllPaid = parseBooleanEnv(process.env.ELEVENLABS_USE_CATHY_FOR_ALL_PAID, true);
  const regularVoiceId =
    regularVoiceOverride || (useCathyForAllPaid ? cathyVoiceId || genericVoiceId : genericVoiceId);
  const premiumVoiceId = premiumVoiceOverride || cathyVoiceId || genericVoiceId;

  const normalized = normalizeAccountType(accountType);
  return normalized === 'premium' || normalized === 'admin' ? premiumVoiceId : regularVoiceId;
}

function canonicalizeModelId(rawModelId) {
  if (typeof rawModelId !== 'string') {
    return null;
  }
  let trimmed = rawModelId.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  const collapsed = normalized.replace(/[^a-z0-9]/g, '');

  if (
    normalized === 'eleven_v3' ||
    normalized === 'eleven-v3' ||
    normalized === 'v3' ||
    normalized === '3' ||
    normalized === '3.0' ||
    collapsed === 'elevenv3' ||
    collapsed === 'v3' ||
    collapsed === '3'
  ) {
    return 'eleven_v3';
  }

  if (
    normalized === 'eleven_turbo_v2_5' ||
    normalized === 'eleven_turbo_v2.5' ||
    normalized === 'eleven_v2.5' ||
    normalized === 'eleven_v25' ||
    normalized === 'eleven-v2-5' ||
    normalized === 'eleven-turbo-v2-5' ||
    normalized === 'v2.5' ||
    normalized === '2.5' ||
    normalized === 'v2_5' ||
    normalized === '2_5' ||
    collapsed === 'elevenv25' ||
    collapsed === 'eleventurbov25' ||
    collapsed === 'v25' ||
    collapsed === '25'
  ) {
    return 'eleven_turbo_v2_5';
  }

  return null;
}

function getModelId() {
  const fromEnv = readFirstNonEmptyEnv('ELEVENLABS_MODEL_ID');
  if (fromEnv) {
    const canonicalModelId = canonicalizeModelId(fromEnv);
    return canonicalModelId || fromEnv;
  }

  return DEFAULT_MODEL_ID;
}

function getVoiceSettings() {
  const readNumeric = (value, fallback) => {
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    // Calmer v3 toward a v2.5-like timbre while keeping audio-tag support.
    stability: readNumeric(process.env.ELEVENLABS_STABILITY, 0.72),
    similarity_boost: readNumeric(process.env.ELEVENLABS_SIMILARITY_BOOST, 0.92),
    style: readNumeric(process.env.ELEVENLABS_STYLE, 0.08)
  };
}

async function validateAuthHeader(supabaseAdmin, req, requestId) {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    return { userId: null, error: 'No token' };
  }

  if (!supabaseAdmin) {
    return { userId: null, error: 'Supabase admin client unavailable' };
  }

  try {
    const {
      data: { user },
      error
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return { userId: null, error: error?.message ?? 'Invalid token' };
    }

    return {
      userId: user.id,
      role: typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : null,
      accountType: typeof user.app_metadata?.account_type === 'string' ? user.app_metadata.account_type : null,
      error: null
    };
  } catch (error) {
    console.error(`[api/tts][${requestId}] Token validation failed`, error);
    return { userId: null, error: 'Token validation failed' };
  }
}

async function resolveEffectiveAccountType(supabaseAdmin, userId, fallbackAccountType, role, requestId) {
  const fallback = resolveAccountTypeByRole(fallbackAccountType, role);
  if (fallback === 'admin') {
    return fallback;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('account_type_id')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error(`[api/tts][${requestId}] Failed to read profile account type`, error);
      return fallback;
    }

    if (isRecord(data) && typeof data.account_type_id === 'string' && data.account_type_id.trim()) {
      return resolveAccountTypeByRole(data.account_type_id, role);
    }

    return fallback;
  } catch (error) {
    console.error(`[api/tts][${requestId}] Failed to read profile account type`, error);
    return fallback;
  }
}

function parsePayload(body) {
  if (!isRecord(body)) {
    throw new Error('JSON body is required.');
  }

  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
  const artistId = typeof body.artistId === 'string' ? body.artistId.trim() : '';
  const language = typeof body.language === 'string' ? body.language.trim() : 'fr-CA';
  const purposeRaw = typeof body.purpose === 'string' ? body.purpose.trim().toLowerCase() : '';
  const purpose = purposeRaw === 'greeting' ? 'greeting' : 'reply';

  if (!text) {
    throw new Error('Text is required.');
  }

  if (text.length > MAX_INPUT_TEXT_CHARS) {
    throw new Error(`Text exceeds ${MAX_INPUT_TEXT_CHARS} chars.`);
  }

  if (!artistId) {
    throw new Error('artistId is required.');
  }

  return {
    text,
    artistId,
    language,
    providerText: text.slice(0, MAX_PROVIDER_TEXT_CHARS),
    purpose
  };
}

function resolveLanguageCode(language) {
  if (typeof language !== 'string') {
    return null;
  }

  const trimmed = language.trim().toLowerCase().replace(/_/g, '-');
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^([a-z]{2,3})(?:-[a-z0-9]{2,8}){0,2}$/i);
  if (!match?.[1]) {
    return null;
  }

  const prefix = match[1].toLowerCase();
  return ELEVENLABS_LANGUAGE_CODES.has(prefix) ? prefix : null;
}

function shouldRetryWithoutLanguageCode(status, providerPayload) {
  if (status !== 400 && status !== 422) {
    return false;
  }

  const normalizedPayload = typeof providerPayload === 'string' ? providerPayload.toLowerCase() : '';
  return (
    normalizedPayload.includes('language') ||
    normalizedPayload.includes('language_code') ||
    normalizedPayload.includes('locale')
  );
}

async function getMonthlyTtsUsageCount(supabaseAdmin, userId, requestId) {
  const monthStartIso = getMonthStartIso();

  const { count, error } = await supabaseAdmin
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('endpoint', 'tts')
    .gte('created_at', monthStartIso);

  if (error) {
    console.error(`[api/tts][${requestId}] Failed to read TTS usage`, error);
    return { ok: false, count: 0, monthStartIso };
  }

  return {
    ok: true,
    count: typeof count === 'number' ? count : 0,
    monthStartIso
  };
}

function getTtsRateLimitMaxRequests(accountType) {
  const normalized = normalizeAccountType(accountType);
  const tierEnvKey = `TTS_RATE_LIMIT_MAX_REQUESTS_${normalized.toUpperCase()}`;
  const tierFromEnv = parsePositiveInt(process.env[tierEnvKey], 0);
  if (tierFromEnv > 0) {
    return tierFromEnv;
  }

  const fromSharedEnv = parsePositiveInt(process.env.TTS_RATE_LIMIT_MAX_REQUESTS, 0);
  if (fromSharedEnv > 0) {
    return fromSharedEnv;
  }

  return DEFAULT_TTS_RATE_LIMIT_MAX_REQUESTS_BY_TIER[normalized] ?? DEFAULT_TTS_RATE_LIMIT_MAX_REQUESTS;
}

async function enforceUserRateLimit(supabaseAdmin, userId, accountType, requestId, ttsCharacters) {
  const nowMs = Date.now();
  const windowMs = parsePositiveInt(process.env.TTS_RATE_LIMIT_WINDOW_MS, DEFAULT_TTS_RATE_LIMIT_WINDOW_MS);
  const maxRequests = getTtsRateLimitMaxRequests(accountType);
  const windowStartIso = new Date(nowMs - windowMs).toISOString();

  const { count, error } = await supabaseAdmin
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('endpoint', 'tts')
    .gte('created_at', windowStartIso);

  if (error) {
    console.error(`[api/tts][${requestId}] Failed to enforce rate limit`, error);
    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Rate limit store unavailable.'
    };
  }

  if ((count ?? 0) >= maxRequests) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded.',
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000))
    };
  }

  const nowIso = new Date(nowMs).toISOString();
  const insertPayload = {
    user_id: userId,
    endpoint: 'tts',
    request_id: requestId,
    created_at: nowIso,
    ...(typeof ttsCharacters === 'number' && { tts_characters: ttsCharacters })
  };

  const { error: insertError } = await supabaseAdmin.from('usage_events').insert(insertPayload);

  if (insertError) {
    console.error(`[api/tts][${requestId}] Failed to write usage_events`, insertError);
    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Rate limit store unavailable.'
    };
  }

  return { ok: true, retryAfterSeconds: 0 };
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

  const missingEnv = getMissingEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ELEVENLABS_API_KEY']);
  if (missingEnv.length > 0) {
    console.error(`[api/tts][${requestId}] Missing env vars: ${missingEnv.join(', ')}`);
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const ipRateLimit = await checkIpRateLimit(req, {
    requestId,
    maxRequests: parsePositiveInt(process.env.TTS_IP_RATE_LIMIT_MAX_REQUESTS, 100),
    windowMs: parsePositiveInt(process.env.TTS_IP_RATE_LIMIT_WINDOW_MS, 60_000)
  });
  if (!ipRateLimit.ok) {
    if (ipRateLimit.retryAfterSeconds > 0) {
      res.setHeader('Retry-After', String(ipRateLimit.retryAfterSeconds));
    }
    sendError(res, ipRateLimit.status, ipRateLimit.message, { code: ipRateLimit.code, requestId });
    return;
  }

  const auth = await validateAuthHeader(supabaseAdmin, req, requestId);
  if (auth.error) {
    sendError(res, 401, 'Unauthorized.', { code: 'UNAUTHORIZED', requestId });
    return;
  }

  let payload;
  try {
    payload = parsePayload(req.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid payload.';
    sendError(res, 400, message, { code: 'INVALID_REQUEST', requestId });
    return;
  }

  if (payload.artistId !== 'cathy-gauthier') {
    sendError(res, 400, 'Unsupported artist.', { code: 'INVALID_REQUEST', requestId });
    return;
  }

  const normalizedAccountType = await resolveEffectiveAccountType(
    supabaseAdmin,
    auth.userId,
    auth.accountType,
    auth.role,
    requestId
  );

  const monthlyCap = getTtsMonthlyCap(normalizedAccountType);
  const usage = await getMonthlyTtsUsageCount(supabaseAdmin, auth.userId, requestId);
  if (!usage.ok) {
    sendError(res, 500, 'Usage store unavailable.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  if (typeof monthlyCap === 'number' && usage.count >= monthlyCap) {
    sendError(res, 429, 'Voice quota exceeded.', { code: 'TTS_QUOTA_EXCEEDED', requestId });
    return;
  }

  const ttsCharacters = typeof payload.providerText === 'string' ? payload.providerText.length : undefined;
  const rateLimit = await enforceUserRateLimit(supabaseAdmin, auth.userId, normalizedAccountType, requestId, ttsCharacters);
  if (!rateLimit.ok) {
    if (rateLimit.status === 429 && typeof rateLimit.retryAfterSeconds === 'number') {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
    }
    sendError(res, rateLimit.status, rateLimit.message, { code: rateLimit.code, requestId });
    return;
  }

  const elevenLabsApiKey = (process.env.ELEVENLABS_API_KEY ?? '').trim();
  const voiceId = resolveVoiceIdForTier(normalizedAccountType);
  const modelId = getModelId();
  const fetchTimeoutMs = parsePositiveInt(process.env.ELEVENLABS_FETCH_TIMEOUT_MS, 20_000);
  const resolvedLanguageCode = resolveLanguageCode(payload.language);

  const buildProviderBody = (includeLanguageCode) => {
    const body = {
      text: payload.providerText,
      model_id: modelId,
      output_format: 'mp3_44100_128',
      voice_settings: getVoiceSettings()
    };

    if (includeLanguageCode && resolvedLanguageCode) {
      body.language_code = resolvedLanguageCode;
    }

    return body;
  };

  const requestUpstream = async (includeLanguageCode) => {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), fetchTimeoutMs);
    try {
      return await fetch(`${ELEVENLABS_API_BASE}/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': elevenLabsApiKey,
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildProviderBody(includeLanguageCode)),
        signal: timeoutController.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  let upstreamResponse;
  let providerPayload = '';
  try {
    upstreamResponse = await requestUpstream(true);
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      sendError(res, 503, 'TTS provider unavailable.', { code: 'TTS_PROVIDER_ERROR', requestId });
      return;
    }

    console.error(`[api/tts][${requestId}] Failed to reach ElevenLabs`, error);
    sendError(res, 503, 'TTS provider unavailable.', { code: 'TTS_PROVIDER_ERROR', requestId });
    return;
  }

  if (!upstreamResponse.ok && resolvedLanguageCode) {
    try {
      providerPayload = await upstreamResponse.text();
    } catch {
      providerPayload = '';
    }

    if (shouldRetryWithoutLanguageCode(upstreamResponse.status, providerPayload)) {
      try {
        upstreamResponse = await requestUpstream(false);
        providerPayload = '';
      } catch (error) {
        if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
          sendError(res, 503, 'TTS provider unavailable.', { code: 'TTS_PROVIDER_ERROR', requestId });
          return;
        }

        console.error(`[api/tts][${requestId}] Failed to reach ElevenLabs`, error);
        sendError(res, 503, 'TTS provider unavailable.', { code: 'TTS_PROVIDER_ERROR', requestId });
        return;
      }
    }
  }

  if (!upstreamResponse.ok) {
    if (upstreamResponse.status === 402 || upstreamResponse.status === 429) {
      sendError(res, 429, 'Voice quota exceeded.', { code: 'TTS_QUOTA_EXCEEDED', requestId });
      return;
    }

    if (!providerPayload) {
      try {
        providerPayload = await upstreamResponse.text();
      } catch {
        providerPayload = '';
      }
    }

    console.error(`[api/tts][${requestId}] ElevenLabs returned ${upstreamResponse.status}`, {
      providerPayload: providerPayload || '(empty body)',
      modelId,
      voiceId
    });
    sendError(res, 503, 'TTS provider unavailable.', { code: 'TTS_PROVIDER_ERROR', requestId });
    return;
  }

  let audioBuffer;
  try {
    audioBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
  } catch (error) {
    console.error(`[api/tts][${requestId}] Failed to read ElevenLabs audio`, error);
    sendError(res, 503, 'TTS provider unavailable.', { code: 'TTS_PROVIDER_ERROR', requestId });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.send(audioBuffer);
};
