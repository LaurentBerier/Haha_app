const { attachRequestId, getMissingEnv, getSupabaseAdmin, sendError, setCorsHeaders } = require('./_utils');
const { extractBearerToken } = require('./_utils');

// Pricing constants (USD)
const CLAUDE_INPUT_COST_PER_TOKEN = 3 / 1_000_000;   // $3 / 1M input tokens
const CLAUDE_OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;  // $15 / 1M output tokens
// ElevenLabs is flat-rate — override via env var at launch (e.g. TTS_COST_PER_1K_CHARS=0.18)
const TTS_COST_PER_1K_CHARS = parseFloat(process.env.TTS_COST_PER_1K_CHARS ?? '0') || 0;

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
    console.error(`[api/admin-stats][${requestId}] Token validation failed`, err);
    return { ok: false, error: 'Token validation failed', status: 401 };
  }
}

function getPeriodStart(period) {
  const now = new Date();
  if (period === '7d') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6)).toISOString();
  }
  if (period === '30d') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29)).toISOString();
  }
  // Default: month-to-date
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function toCamelRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => {
    if (!isRecord(row)) {
      return row;
    }

    return {
      day: row.day ?? null,
      tier: row.tier ?? null,
      endpoint: row.endpoint ?? null,
      uniqueUsers: Number(row.unique_users ?? 0),
      requests: Number(row.requests ?? 0),
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      ttsChars: Number(row.tts_chars ?? 0)
    };
  });
}

function toRevenueCamelRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => {
    if (!isRecord(row)) {
      return row;
    }

    return {
      month: row.month ?? null,
      tier: row.tier ?? null,
      eventType: row.event_type ?? null,
      events: Number(row.events ?? 0),
      totalCents: Number(row.total_cents ?? 0)
    };
  });
}

function computeEstimatedCostCents(usageRows) {
  let totalCostUsd = 0;

  for (const row of usageRows) {
    if (!isRecord(row)) {
      continue;
    }

    const inputTokens = Number(row.input_tokens ?? 0);
    const outputTokens = Number(row.output_tokens ?? 0);
    const ttsChars = Number(row.tts_chars ?? 0);

    totalCostUsd += inputTokens * CLAUDE_INPUT_COST_PER_TOKEN;
    totalCostUsd += outputTokens * CLAUDE_OUTPUT_COST_PER_TOKEN;
    totalCostUsd += (ttsChars / 1000) * TTS_COST_PER_1K_CHARS;
  }

  return Math.round(totalCostUsd * 100);
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
      console.error(`[api/admin-stats][${requestId}] Missing env vars: ${missingEnv.join(', ')}`);
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

  const rawPeriod = typeof req.query?.period === 'string' ? req.query.period : 'mtd';
  const period = ['7d', '30d', 'mtd'].includes(rawPeriod) ? rawPeriod : 'mtd';
  const periodStart = getPeriodStart(period);

  try {
    const [usageResult, revenueResult] = await Promise.all([
      supabaseAdmin
        .from('admin_daily_usage')
        .select('*')
        .gte('day', periodStart.slice(0, 10)),
      supabaseAdmin
        .from('admin_revenue_summary')
        .select('*')
        .gte('month', periodStart.slice(0, 10))
    ]);

    if (usageResult.error) {
      console.error(`[api/admin-stats][${requestId}] Failed to query admin_daily_usage`, usageResult.error);
      sendError(res, 500, usageResult.error.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    if (revenueResult.error) {
      console.error(`[api/admin-stats][${requestId}] Failed to query admin_revenue_summary`, revenueResult.error);
      sendError(res, 500, revenueResult.error.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    const dailyUsage = toCamelRows(usageResult.data ?? []);
    const revenue = toRevenueCamelRows(revenueResult.data ?? []);
    const estimatedCostCents = computeEstimatedCostCents(usageResult.data ?? []);
    const totalRevenueCents = revenue.reduce((sum, row) => sum + row.totalCents, 0);

    res.status(200).json({
      ok: true,
      period,
      periodStart,
      dailyUsage,
      revenue,
      estimatedCostCents,
      totalRevenueCents
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    console.error(`[api/admin-stats][${requestId}] Unhandled error`, err);
    sendError(res, 500, message, { code: 'SERVER_ERROR', requestId });
  }
};
