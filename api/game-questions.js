const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;
const DEFAULT_OVERLOAD_RETRY_AFTER_SECONDS = 3;
const TRANSIENT_UPSTREAM_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

const {
  attachRequestId,
  extractBearerToken,
  getMissingEnv,
  getSupabaseAdmin,
  sendError,
  setCorsHeaders
} = require('./_utils');
const {
  enforceMonthlyQuota,
  getRetryAfterUntilNextMonthSeconds,
  parsePositiveInt,
  recordUsageEvent,
  writeProfileMonthlyCounter
} = require('./_quota-utils');
const { resolveEffectiveAccountType } = require('./_account-tier');
const { computeQuotaRatioForUser, isExpensiveModesAllowed } = require('./_quota-status');

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseRetryAfterSeconds(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return null;
  }

  const asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt) && asInt > 0) {
    return asInt;
  }

  const asDateMs = Date.parse(raw);
  if (!Number.isFinite(asDateMs)) {
    return null;
  }

  const deltaSeconds = Math.ceil((asDateMs - Date.now()) / 1000);
  return deltaSeconds > 0 ? deltaSeconds : null;
}

function getErrorStatus(error) {
  if (!isRecord(error)) {
    return null;
  }

  const parsed = Number.parseInt(String(error.status ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getErrorRetryAfterSeconds(error) {
  if (!isRecord(error)) {
    return null;
  }

  if (Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds > 0) {
    return Math.ceil(error.retryAfterSeconds);
  }

  if (typeof error.retryAfter === 'string') {
    return parseRetryAfterSeconds(error.retryAfter);
  }

  return null;
}

function isTransientUpstreamOverload(error) {
  const status = getErrorStatus(error);
  if (Number.isFinite(status) && TRANSIENT_UPSTREAM_STATUSES.has(status)) {
    return true;
  }

  if (!isRecord(error)) {
    return false;
  }

  const code = normalizeText(error.code).toLowerCase();
  if (code.includes('overload')) {
    return true;
  }

  const message = normalizeText(error.message).toLowerCase();
  return message.includes('overloaded') || message.includes('overload');
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
Always speak in first person when referring to yourself (I/me/my), never "Cathy" in third person.
2 must be true or highly plausible. 1 must be invented but credible.
The invented one must not be obvious.
Prioritize Quebec/Canada references and, when relevant, major widely-known current events.
Do not invent precise facts, numbers, or dates when uncertain.
Keep the statements punchy, funny, and surprising while remaining plausible.

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
Quand tu parles de toi, utilise toujours je/moi/mon, jamais "Cathy" a la troisieme personne.
2 doivent etre vraies ou tres plausibles. 1 doit etre inventee mais credible.
L'inventee ne doit pas etre evidente.
Priorise des references Quebec/Canada et, quand pertinent, des faits d'actualite marquants largement connus.
N'invente pas de faits precis, chiffres ou dates si tu n'es pas certaine.
Garde des affirmations punchy, droles et surprenantes tout en restant plausibles.

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
      if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.type === 'string') {
        error.code = payload.error.type;
      }
      const retryAfterHeader =
        response.headers && typeof response.headers.get === 'function' ? response.headers.get('retry-after') : '';
      const retryAfterSeconds = parseRetryAfterSeconds(retryAfterHeader);
      if (Number.isFinite(retryAfterSeconds)) {
        error.retryAfterSeconds = retryAfterSeconds;
      }
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
  } catch (error) {
    if (isRecord(error) && error.name === 'AbortError') {
      const timeoutError = new Error('Question generator timed out.');
      timeoutError.code = 'UPSTREAM_TIMEOUT';
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sendQuestionUpstreamError(res, requestId, error) {
  if (isRecord(error) && error.code === 'UPSTREAM_TIMEOUT') {
    sendError(res, 504, 'Question generator timed out.', { code: 'UPSTREAM_TIMEOUT', requestId, error });
    return;
  }

  if (isTransientUpstreamOverload(error)) {
    const retryAfterSeconds = getErrorRetryAfterSeconds(error) ?? DEFAULT_OVERLOAD_RETRY_AFTER_SECONDS;
    res.setHeader('Retry-After', String(Math.max(1, retryAfterSeconds)));
    sendError(res, 503, 'Question generator is temporarily overloaded. Please retry.', {
      code: 'UPSTREAM_OVERLOADED',
      requestId,
      capture: false,
      error
    });
    return;
  }

  const upstreamStatus = getErrorStatus(error);
  const status =
    Number.isFinite(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599 ? upstreamStatus : 502;
  const message = error instanceof Error && error.message ? error.message : 'Question generator unavailable.';
  sendError(res, status, message, { code: 'UPSTREAM_ERROR', requestId, error });
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

  const accountTypeRaw =
    typeof user.app_metadata?.account_type === 'string' && user.app_metadata.account_type.trim()
      ? user.app_metadata.account_type.trim()
      : 'free';
  const roleRaw = typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : null;
  const accountType = resolveEffectiveAccountType(accountTypeRaw, roleRaw);

  const monthlyQuota = await enforceMonthlyQuota({
    supabaseAdmin,
    userId: user.id,
    accountType,
    requestId,
    logPrefix: 'api/game-questions',
    usageEndpoints: ['claude', 'game-questions', 'game-judge']
  });
  if (!monthlyQuota.ok) {
    if (monthlyQuota.status === 429) {
      res.setHeader('Retry-After', String(getRetryAfterUntilNextMonthSeconds()));
    }
    sendError(res, monthlyQuota.status, monthlyQuota.message, { code: monthlyQuota.code, requestId });
    return;
  }

  const ratioResult = await computeQuotaRatioForUser(supabaseAdmin, user.id, accountType, requestId);
  if (ratioResult.ok && !isExpensiveModesAllowed(ratioResult.ratio)) {
    sendError(res, 403, 'This feature is paused until your quota resets.', {
      code: 'EXPENSIVE_MODE_QUOTA_GATED',
      requestId
    });
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
    sendQuestionUpstreamError(res, requestId, error);
    return;
  }

  const usageInsert = await recordUsageEvent({
    supabaseAdmin,
    userId: user.id,
    endpoint: 'game-questions',
    requestId
  });
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
      requestId,
      'api/game-questions'
    );

    if (!counterUpdate.ok) {
      sendError(res, 500, 'Usage store unavailable.', { code: 'SERVER_MISCONFIGURED', requestId });
      return;
    }
  }

  res.status(200).json(question);
};
