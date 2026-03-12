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

    console.error(`[api/game-judge][${requestId}] Failed to read profile monthly counter`, error);
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

    console.error(`[api/game-judge][${requestId}] Failed to write profile monthly counter`, error);
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
    .in('endpoint', ['claude', 'game-questions', 'game-judge', 'impro-themes'])
    .gte('created_at', monthStartIso);

  if (error) {
    console.error(`[api/game-judge][${requestId}] Failed to read monthly usage`, error);
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
    endpoint: 'game-judge',
    request_id: requestId,
    created_at: nowIso
  };

  let { error } = await supabaseAdmin.from('usage_events').insert(insertPayload);
  if (error && isMissingUsageEventsRequestIdColumn(error)) {
    const fallbackPayload = {
      user_id: userId,
      endpoint: 'game-judge',
      created_at: nowIso
    };
    ({ error } = await supabaseAdmin.from('usage_events').insert(fallbackPayload));
  }

  if (error) {
    return { ok: false, error };
  }

  return { ok: true };
}

function normalizeRoundValue(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function toNumeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pickNumeric(source, keys) {
  for (const key of keys) {
    if (!isRecord(source)) {
      return null;
    }
    const value = toNumeric(source[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function parsePayload(body) {
  if (!isRecord(body)) {
    throw new Error('JSON body is required.');
  }

  const artistId = typeof body.artistId === 'string' ? body.artistId.trim() : '';
  const userRoast = typeof body.userRoast === 'string' ? body.userRoast.trim() : '';
  const artistRoast = typeof body.artistRoast === 'string' ? body.artistRoast.trim() : '';
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'fr-CA';
  const round = normalizeRoundValue(body.round, 1);
  const totalRounds = normalizeRoundValue(body.totalRounds, Math.max(round, 3));

  if (!artistId) {
    throw new Error('artistId is required.');
  }
  if (!userRoast || !artistRoast) {
    throw new Error('Both userRoast and artistRoast are required.');
  }
  if (userRoast.length > 4000 || artistRoast.length > 4000) {
    throw new Error('Roast payload is too long.');
  }

  return {
    artistId,
    round,
    totalRounds,
    userRoast,
    artistRoast,
    language
  };
}

function buildJudgeSystemPrompt(language) {
  const isEnglish = typeof language === 'string' && language.toLowerCase().startsWith('en');
  if (isEnglish) {
    return `You are the official judge of a roast duel. Evaluate both roasts impartially.
Criteria (0-10): wit, specificity, delivery, crowdReaction, comebackPotential.
Return ONLY valid JSON:
{
  "userScore": { "wit": X, "specificity": X, "delivery": X, "crowdReaction": X, "comebackPotential": X, "total": X, "verdict": "1-2 funny lines" },
  "artistScore": { "wit": X, "specificity": X, "delivery": X, "crowdReaction": X, "comebackPotential": X, "total": X, "verdict": "1-2 funny lines" }
}`;
  }

  return `Tu es l'arbitre officiel d'un duel de roast. Evalue les deux roasts avec impartialite.
Criteres (0-10): wit, specificity, delivery, crowdReaction, comebackPotential.
Retourne UNIQUEMENT un JSON valide:
{
  "userScore": { "wit": X, "specificity": X, "delivery": X, "crowdReaction": X, "comebackPotential": X, "total": X, "verdict": "1-2 phrases comiques" },
  "artistScore": { "wit": X, "specificity": X, "delivery": X, "crowdReaction": X, "comebackPotential": X, "total": X, "verdict": "1-2 phrases comiques" }
}`;
}

function buildJudgeUserPrompt(input) {
  return `[Round ${input.round}/${input.totalRounds}]
Artiste: ${input.artistId}

Roast utilisateur:
${input.userRoast}

Roast artiste:
${input.artistRoast}`;
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

function clamp(value, min, max) {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeJudgeScore(raw, fallbackVerdict) {
  const safe = isRecord(raw) ? raw : {};
  const wit = clamp(pickNumeric(safe, ['wit', 'wit_originality', 'witOriginality']) ?? 0, 0, 10);
  const specificity = clamp(pickNumeric(safe, ['specificity']) ?? 0, 0, 10);
  const delivery = clamp(pickNumeric(safe, ['delivery', 'delivery_timing', 'deliveryTiming']) ?? 0, 0, 10);
  const crowdReaction = clamp(pickNumeric(safe, ['crowdReaction', 'crowd_reaction', 'crowd']) ?? 0, 0, 10);
  const comebackPotential = clamp(
    pickNumeric(safe, ['comebackPotential', 'comeback_potential', 'comeback']) ?? 0,
    0,
    10
  );
  const computedTotal = wit + specificity + delivery + crowdReaction + comebackPotential;
  const providedTotal = typeof safe.total === 'number' && Number.isFinite(safe.total) ? safe.total : computedTotal;
  const total = clamp(providedTotal, 0, 50);
  const verdict =
    typeof safe.verdict === 'string' && safe.verdict.trim() ? safe.verdict.trim().slice(0, 320) : fallbackVerdict;

  return {
    wit,
    specificity,
    delivery,
    crowdReaction,
    comebackPotential,
    total,
    verdict
  };
}

function parseJudgeVerdict(rawText) {
  const text = stripCodeFences(rawText);
  let payload = null;

  try {
    payload = JSON.parse(text);
  } catch {
    const extracted = extractJsonObject(text);
    if (!extracted) {
      throw new Error('Judge response is not valid JSON.');
    }
    payload = JSON.parse(extracted);
  }

  if (!isRecord(payload)) {
    throw new Error('Judge response has invalid shape.');
  }

  return {
    userScore: normalizeJudgeScore(payload.userScore, 'Bon punchline, execution a raffiner.'),
    artistScore: normalizeJudgeScore(payload.artistScore, 'Replique solide, mais perfectible.')
  };
}

async function callJudgeModel(input) {
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
        max_tokens: 400,
        temperature: 0.7,
        stream: false,
        system: buildJudgeSystemPrompt(input.language),
        messages: [{ role: 'user', content: buildJudgeUserPrompt(input) }]
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
          : 'Judge request failed.';
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    const rawText = extractResponseText(payload);
    if (!rawText.trim()) {
      throw new Error('Judge response is empty.');
    }

    try {
      return parseJudgeVerdict(rawText);
    } catch (error) {
      const parseError = new Error(error instanceof Error ? error.message : 'Judge parse failed.');
      parseError.code = 'JUDGE_PARSE_FAILED';
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

  let verdict;
  try {
    verdict = await callJudgeModel(input);
  } catch (error) {
    if (isRecord(error) && error.code === 'JUDGE_PARSE_FAILED') {
      sendError(res, 422, 'Judge output is invalid.', { code: 'JUDGE_PARSE_FAILED', requestId });
      return;
    }
    const message = error instanceof Error && error.message ? error.message : 'Judge unavailable.';
    sendError(res, 502, message, { code: 'UPSTREAM_ERROR', requestId });
    return;
  }

  const usageInsert = await recordUsageEvent(supabaseAdmin, user.id, requestId);
  if (!usageInsert.ok) {
    console.error(`[api/game-judge][${requestId}] Failed to write usage_events`, usageInsert.error);
    sendError(res, 500, 'Usage store unavailable.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  if (monthlyQuota.source === 'profile') {
    const used = typeof monthlyQuota.used === 'number' && Number.isFinite(monthlyQuota.used) ? monthlyQuota.used : 0;
    const nextCount = used + 1;
    const counterUpdate = await writeProfileMonthlyCounter(
      supabaseAdmin,
      user.id,
      monthlyQuota.monthStartIso,
      nextCount,
      requestId
    );

    if (!counterUpdate.ok) {
      sendError(res, 500, 'Usage store unavailable.', { code: 'SERVER_MISCONFIGURED', requestId });
      return;
    }
  }

  res.status(200).json(verdict);
};
