const {
  attachRequestId,
  extractBearerToken,
  getMissingEnv,
  getSupabaseAdmin,
  sendError,
  setCorsHeaders
} = require('./_utils');

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE_ID_GENERIC = 'cgSgspJ2msm6clMCkdW9';
const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5';
const DEFAULT_TTS_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_TTS_RATE_LIMIT_MAX_REQUESTS = 20;
const MAX_INPUT_TEXT_CHARS = 5_000;
const MAX_PROVIDER_TEXT_CHARS = 1_000;
const DEFAULT_TTS_CAPS = {
  regular: 200,
  premium: 500
};

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeAccountType(accountType) {
  if (typeof accountType === 'string' && accountType.trim()) {
    const normalized = accountType.trim().toLowerCase();
    if (normalized === 'free' || normalized === 'regular' || normalized === 'premium' || normalized === 'admin') {
      return normalized;
    }

    const compact = normalized.replace(/[\s_-]+/g, '');
    if (compact === 'unlimited') {
      return 'regular';
    }
    if (compact === 'proartist') {
      return 'premium';
    }
  }
  return 'free';
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
    typeof process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC === 'string' &&
    process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC.trim()
      ? process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC.trim()
      : DEFAULT_VOICE_ID_GENERIC;

  const premiumVoiceId =
    typeof process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY === 'string' && process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY.trim()
      ? process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY.trim()
      : genericVoiceId;

  const normalized = normalizeAccountType(accountType);
  return normalized === 'premium' || normalized === 'admin' ? premiumVoiceId : genericVoiceId;
}

function getModelId() {
  if (typeof process.env.ELEVENLABS_MODEL_ID === 'string' && process.env.ELEVENLABS_MODEL_ID.trim()) {
    return process.env.ELEVENLABS_MODEL_ID.trim();
  }

  return DEFAULT_MODEL_ID;
}

function getVoiceSettings() {
  const readNumeric = (value, fallback) => {
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    stability: readNumeric(process.env.ELEVENLABS_STABILITY, 0.5),
    similarity_boost: readNumeric(process.env.ELEVENLABS_SIMILARITY_BOOST, 0.8),
    style: readNumeric(process.env.ELEVENLABS_STYLE, 0.35)
  };
}

function isMissingUsageEventsRequestIdColumn(error) {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
  if (code !== '42703') {
    return false;
  }

  const message = isRecord(error) && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return message.includes('request_id');
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
      accountType: typeof user.app_metadata?.account_type === 'string' ? user.app_metadata.account_type : null,
      error: null
    };
  } catch (error) {
    console.error(`[api/tts][${requestId}] Token validation failed`, error);
    return { userId: null, error: 'Token validation failed' };
  }
}

async function resolveEffectiveAccountType(supabaseAdmin, userId, fallbackAccountType, requestId) {
  const fallback = normalizeAccountType(fallbackAccountType);

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
      return normalizeAccountType(data.account_type_id);
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
    providerText: text.slice(0, MAX_PROVIDER_TEXT_CHARS)
  };
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

async function enforceUserRateLimit(supabaseAdmin, userId, requestId) {
  const nowMs = Date.now();
  const windowMs = parsePositiveInt(process.env.TTS_RATE_LIMIT_WINDOW_MS, DEFAULT_TTS_RATE_LIMIT_WINDOW_MS);
  const maxRequests = parsePositiveInt(process.env.TTS_RATE_LIMIT_MAX_REQUESTS, DEFAULT_TTS_RATE_LIMIT_MAX_REQUESTS);
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
    created_at: nowIso
  };

  let { error: insertError } = await supabaseAdmin.from('usage_events').insert(insertPayload);
  if (insertError && isMissingUsageEventsRequestIdColumn(insertError)) {
    ({ error: insertError } = await supabaseAdmin.from('usage_events').insert({
      user_id: userId,
      endpoint: 'tts',
      created_at: nowIso
    }));
  }

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
    requestId
  );
  const isPaidTier = normalizedAccountType === 'regular' || normalizedAccountType === 'premium' || normalizedAccountType === 'admin';
  if (!isPaidTier) {
    sendError(res, 403, 'Voice quota exceeded.', { code: 'TTS_QUOTA_EXCEEDED', requestId });
    return;
  }

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

  const rateLimit = await enforceUserRateLimit(supabaseAdmin, auth.userId, requestId);
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
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), fetchTimeoutMs);

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(`${ELEVENLABS_API_BASE}/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsApiKey,
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: payload.providerText,
        model_id: modelId,
        output_format: 'mp3_44100_128',
        voice_settings: getVoiceSettings(),
        language_code: payload.language.toLowerCase().startsWith('en') ? 'en' : 'fr'
      }),
      signal: timeoutController.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      sendError(res, 503, 'TTS provider unavailable.', { code: 'TTS_PROVIDER_ERROR', requestId });
      return;
    }

    console.error(`[api/tts][${requestId}] Failed to reach ElevenLabs`, error);
    sendError(res, 503, 'TTS provider unavailable.', { code: 'TTS_PROVIDER_ERROR', requestId });
    return;
  } finally {
    clearTimeout(timeout);
  }

  if (!upstreamResponse.ok) {
    if (upstreamResponse.status === 402 || upstreamResponse.status === 429) {
      sendError(res, 429, 'Voice quota exceeded.', { code: 'TTS_QUOTA_EXCEEDED', requestId });
      return;
    }

    let providerPayload = '';
    try {
      providerPayload = await upstreamResponse.text();
    } catch {
      providerPayload = '';
    }

    console.error(
      `[api/tts][${requestId}] ElevenLabs returned ${upstreamResponse.status}`,
      providerPayload || '(empty body)'
    );
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
