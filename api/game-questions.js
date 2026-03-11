const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;
const DEFAULT_MONTHLY_CAPS = {
  free: 15,
  regular: 45,
  premium: 110
  // admin intentionally omitted => unlimited
};

const {
  attachRequestId,
  extractBearerToken,
  getMissingEnv,
  getSupabaseAdmin,
  sendError,
  setCorsHeaders
} = require('./_utils');

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function getNextMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

function getRetryAfterUntilNextMonthSeconds() {
  const nextMonthStartMs = Date.parse(getNextMonthStartIso());
  return Math.max(1, Math.ceil((nextMonthStartMs - Date.now()) / 1000));
}

function getMonthlyCap(accountType) {
  const normalizedAccountType = typeof accountType === 'string' && accountType.trim() ? accountType.trim() : 'free';
  const key = `CLAUDE_MONTHLY_CAP_${normalizedAccountType.toUpperCase()}`;
  const fromEnv = parsePositiveInt(process.env[key], 0);
  if (fromEnv > 0) {
    return fromEnv;
  }

  const cap = DEFAULT_MONTHLY_CAPS[normalizedAccountType];
  return cap ?? DEFAULT_MONTHLY_CAPS.free;
}

function isMissingMonthlyCounterColumnError(error) {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
  if (code === '42703') {
    return true;
  }

  const message = isRecord(error) && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return message.includes('monthly_message_count') || message.includes('monthly_reset_at');
}

function isMissingUsageEventsRequestIdColumn(error) {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
  if (code !== '42703') {
    return false;
  }

  const message = isRecord(error) && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return message.includes('request_id');
}

async function readProfileMonthlyCounter(supabaseAdmin, userId, requestId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('monthly_message_count, monthly_reset_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    if (isMissingMonthlyCounterColumnError(error)) {
      return { ok: true, unsupported: true };
    }

    console.error(`[api/game-questions][${requestId}] Failed to read profile monthly counter`, error);
    return { ok: false, error };
  }

  if (!data || !isRecord(data)) {
    return { ok: true, unsupported: true };
  }

  return {
    ok: true,
    unsupported: false,
    monthlyMessageCount:
      typeof data.monthly_message_count === 'number' && Number.isFinite(data.monthly_message_count)
        ? Math.max(0, Math.floor(data.monthly_message_count))
        : 0,
    monthlyResetAt: typeof data.monthly_reset_at === 'string' ? data.monthly_reset_at : ''
  };
}

async function writeProfileMonthlyCounter(supabaseAdmin, userId, monthStartIso, nextCount, requestId) {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      monthly_message_count: Math.max(0, nextCount),
      monthly_reset_at: monthStartIso
    })
    .eq('id', userId);

  if (error) {
    if (isMissingMonthlyCounterColumnError(error)) {
      return { ok: true, unsupported: true };
    }

    console.error(`[api/game-questions][${requestId}] Failed to write profile monthly counter`, error);
    return { ok: false, error };
  }

  return { ok: true, unsupported: false };
}

async function enforceMonthlyQuota(supabaseAdmin, userId, accountType, requestId) {
  const normalizedAccountType = typeof accountType === 'string' && accountType.trim() ? accountType.trim() : 'free';
  if (normalizedAccountType === 'admin') {
    return { ok: true, source: 'admin', monthStartIso: getMonthStartIso(), used: 0 };
  }

  const effectiveCap = getMonthlyCap(normalizedAccountType);
  const monthStartIso = getMonthStartIso();

  const profileCounter = await readProfileMonthlyCounter(supabaseAdmin, userId, requestId);
  if (!profileCounter.ok) {
    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Usage store unavailable.'
    };
  }

  if (!profileCounter.unsupported) {
    const monthStartMs = Date.parse(monthStartIso);
    const monthlyResetMs = Date.parse(profileCounter.monthlyResetAt);
    const isCurrentMonth = Number.isFinite(monthlyResetMs) && monthlyResetMs >= monthStartMs;
    const used = isCurrentMonth ? profileCounter.monthlyMessageCount : 0;

    if (used >= effectiveCap) {
      return {
        ok: false,
        status: 429,
        code: 'MONTHLY_QUOTA_EXCEEDED',
        message: `Monthly message quota exceeded. Limit: ${effectiveCap} messages.`
      };
    }

    return { ok: true, source: 'profile', monthStartIso, used };
  }

  const { count, error } = await supabaseAdmin
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('endpoint', ['claude', 'game-questions', 'game-judge'])
    .gte('created_at', monthStartIso);

  if (error) {
    console.error(`[api/game-questions][${requestId}] Failed to read monthly usage`, error);
    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Usage store unavailable.'
    };
  }

  if ((count ?? 0) >= effectiveCap) {
    return {
      ok: false,
      status: 429,
      code: 'MONTHLY_QUOTA_EXCEEDED',
      message: `Monthly message quota exceeded. Limit: ${effectiveCap} messages.`
    };
  }

  return { ok: true, source: 'usage_events', monthStartIso, used: count ?? 0 };
}

async function recordUsageEvent(supabaseAdmin, userId, requestId) {
  const nowIso = new Date().toISOString();
  const insertPayload = {
    user_id: userId,
    endpoint: 'game-questions',
    request_id: requestId,
    created_at: nowIso
  };

  let { error } = await supabaseAdmin.from('usage_events').insert(insertPayload);
  if (error && isMissingUsageEventsRequestIdColumn(error)) {
    const fallbackPayload = {
      user_id: userId,
      endpoint: 'game-questions',
      created_at: nowIso
    };
    ({ error } = await supabaseAdmin.from('usage_events').insert(fallbackPayload));
  }

  if (error) {
    return { ok: false, error };
  }

  return { ok: true };
}

function parsePayload(body) {
  if (!isRecord(body)) {
    throw new Error('JSON body is required.');
  }

  const artistId = typeof body.artistId === 'string' ? body.artistId.trim() : '';
  const gameType = typeof body.gameType === 'string' ? body.gameType.trim() : '';
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'fr-CA';

  if (!artistId) {
    throw new Error('artistId is required.');
  }
  if (gameType !== 'vrai-ou-invente') {
    throw new Error('Unsupported gameType.');
  }

  return {
    artistId,
    gameType,
    language
  };
}

function buildQuestionSystemPrompt(language) {
  const isEnglish = typeof language === 'string' && language.toLowerCase().startsWith('en');

  if (isEnglish) {
    return `You are Cathy Gauthier. Generate exactly 3 statements about yourself.
2 must be true or highly plausible. 1 must be invented but credible.
The invented one must not be obvious.

Return ONLY this JSON:
{
  "statements": [
    { "text": "I already...", "isTrue": true },
    { "text": "I already...", "isTrue": false },
    { "text": "I already...", "isTrue": true }
  ],
  "explanation": "1-2 funny Cathy-style lines explaining which one is fake and why it was credible"
}

Shuffle order randomly.`;
  }

  return `Tu es Cathy Gauthier. Genere exactement 3 affirmations sur toi-meme.
2 doivent etre vraies ou tres plausibles. 1 doit etre inventee mais credible.
L'inventee ne doit pas etre evidente.

Retourne UNIQUEMENT ce JSON:
{
  "statements": [
    { "text": "J'ai deja...", "isTrue": true },
    { "text": "J'ai deja...", "isTrue": false },
    { "text": "J'ai deja...", "isTrue": true }
  ],
  "explanation": "1-2 phrases en mode Cathy expliquant quelle est la fausse et pourquoi c'etait credible"
}

Melange l'ordre aleatoirement.`;
}

function buildQuestionUserPrompt(input) {
  return `ArtistId: ${input.artistId}
Game: ${input.gameType}
Language: ${input.language}`;
}

function extractResponseText(payload) {
  if (!payload || !Array.isArray(payload.content)) {
    return '';
  }

  return payload.content
    .filter((entry) => isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text)
    .join('');
}

function stripCodeFences(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function extractJsonObject(input) {
  const start = input.indexOf('{');
  const end = input.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    return '';
  }
  return input.slice(start, end + 1);
}

function parseQuestionPayload(rawText) {
  const text = stripCodeFences(rawText);
  let payload = null;

  try {
    payload = JSON.parse(text);
  } catch {
    const extracted = extractJsonObject(text);
    if (!extracted) {
      throw new Error('Question response is not valid JSON.');
    }
    payload = JSON.parse(extracted);
  }

  if (!isRecord(payload) || !Array.isArray(payload.statements)) {
    throw new Error('Question response has invalid shape.');
  }

  const statements = payload.statements
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      text: typeof entry.text === 'string' ? entry.text.trim().slice(0, 220) : '',
      isTrue: entry.isTrue === true
    }))
    .filter((entry) => Boolean(entry.text))
    .slice(0, 3);

  if (statements.length !== 3) {
    throw new Error('Question must contain exactly 3 statements.');
  }

  const falseCount = statements.filter((entry) => !entry.isTrue).length;
  if (falseCount !== 1) {
    throw new Error('Question must contain exactly one invented statement.');
  }

  const explanation =
    typeof payload.explanation === 'string' && payload.explanation.trim()
      ? payload.explanation.trim().slice(0, 320)
      : 'La fausse etait la plus credible. Bien joue.';

  return { statements, explanation };
}

async function callQuestionModel(input) {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const timeoutMs = parsePositiveInt(process.env.ANTHROPIC_FETCH_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 350,
        temperature: 0.85,
        stream: false,
        system: buildQuestionSystemPrompt(input.language),
        messages: [{ role: 'user', content: buildQuestionUserPrompt(input) }]
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        isRecord(payload) &&
        isRecord(payload.error) &&
        typeof payload.error.message === 'string' &&
        payload.error.message
          ? payload.error.message
          : 'Question generation failed.';
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    const rawText = extractResponseText(payload);
    if (!rawText.trim()) {
      throw new Error('Question response is empty.');
    }

    try {
      return parseQuestionPayload(rawText);
    } catch (error) {
      const parseError = new Error(error instanceof Error ? error.message : 'Question parse failed.');
      parseError.code = 'QUESTIONS_PARSE_FAILED';
      throw parseError;
    }
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  const requestId = attachRequestId(req, res);
  const corsResult = setCorsHeaders(req, res);
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

  const missingEnv = getMissingEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY']);
  if (missingEnv.length > 0) {
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    sendError(res, 401, 'Unauthorized.', { code: 'UNAUTHORIZED', requestId });
    return;
  }

  const {
    data: { user },
    error: authError
  } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    sendError(res, 401, 'Unauthorized.', { code: 'UNAUTHORIZED', requestId });
    return;
  }

  let input;
  try {
    input = parsePayload(req.body);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Invalid payload.';
    sendError(res, 400, message, { code: 'INVALID_REQUEST', requestId });
    return;
  }

  const accountType =
    typeof user.app_metadata?.account_type === 'string' && user.app_metadata.account_type.trim()
      ? user.app_metadata.account_type.trim()
      : 'free';

  const monthlyQuota = await enforceMonthlyQuota(supabaseAdmin, user.id, accountType, requestId);
  if (!monthlyQuota.ok) {
    if (monthlyQuota.status === 429) {
      res.setHeader('Retry-After', String(getRetryAfterUntilNextMonthSeconds()));
    }
    sendError(res, monthlyQuota.status, monthlyQuota.message, { code: monthlyQuota.code, requestId });
    return;
  }

  let question;
  try {
    question = await callQuestionModel(input);
  } catch (error) {
    if (isRecord(error) && error.code === 'QUESTIONS_PARSE_FAILED') {
      sendError(res, 422, 'Question output is invalid.', { code: 'QUESTIONS_PARSE_FAILED', requestId });
      return;
    }
    const message = error instanceof Error && error.message ? error.message : 'Question generator unavailable.';
    sendError(res, 502, message, { code: 'UPSTREAM_ERROR', requestId });
    return;
  }

  const usageInsert = await recordUsageEvent(supabaseAdmin, user.id, requestId);
  if (!usageInsert.ok) {
    console.error(`[api/game-questions][${requestId}] Failed to write usage_events`, usageInsert.error);
    sendError(res, 500, 'Usage store unavailable.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  if (monthlyQuota.source === 'profile') {
    const used = typeof monthlyQuota.used === 'number' && Number.isFinite(monthlyQuota.used) ? monthlyQuota.used : 0;
    const counterUpdate = await writeProfileMonthlyCounter(
      supabaseAdmin,
      user.id,
      monthlyQuota.monthStartIso,
      used + 1,
      requestId
    );

    if (!counterUpdate.ok) {
      sendError(res, 500, 'Usage store unavailable.', { code: 'SERVER_MISCONFIGURED', requestId });
      return;
    }
  }

  res.status(200).json(question);
};

