const { attachRequestId, getMissingEnv, getSupabaseAdmin, sendError, setCorsHeaders } = require('./_utils');
const { extractBearerToken } = require('./_utils');

// Pricing constants (USD)
const CLAUDE_INPUT_COST_PER_TOKEN = 3 / 1_000_000; // $3 / 1M input tokens
const CLAUDE_OUTPUT_COST_PER_TOKEN = 15 / 1_000_000; // $15 / 1M output tokens
const DEFAULT_TTS_COST_PER_1K_CHARS = 0.18;
const KNOWN_TIERS = ['free', 'regular', 'premium', 'admin'];
const TIMESERIES_PAGE_SIZE = 1000;

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function parseFinitePositiveNumber(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getTtsCostPer1kChars() {
  return parseFinitePositiveNumber(process.env.TTS_COST_PER_1K_CHARS, DEFAULT_TTS_COST_PER_1K_CHARS);
}

function startOfUtcHour(date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    0,
    0,
    0
  ));
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(date) {
  const dayStart = startOfUtcDay(date);
  const day = dayStart.getUTCDay();
  const offset = (day + 6) % 7; // Monday = 0
  return new Date(dayStart.getTime() - offset * 24 * 60 * 60 * 1000);
}

function startOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addHours(date, amount) {
  return new Date(date.getTime() + amount * 60 * 60 * 1000);
}

function addDays(date, amount) {
  return new Date(date.getTime() + amount * 24 * 60 * 60 * 1000);
}

function addWeeks(date, amount) {
  return addDays(date, amount * 7);
}

function addMonths(date, amount) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

function normalizeGranularity(value) {
  if (value === 'hour' || value === 'day' || value === 'week' || value === 'month') {
    return value;
  }
  return 'day';
}

function getTimeseriesBuckets(granularity) {
  const now = new Date();

  if (granularity === 'hour') {
    const current = startOfUtcHour(now);
    const first = addHours(current, -23);
    return Array.from({ length: 24 }, (_, index) => addHours(first, index));
  }

  if (granularity === 'week') {
    const current = startOfUtcWeek(now);
    const first = addWeeks(current, -11);
    return Array.from({ length: 12 }, (_, index) => addWeeks(first, index));
  }

  if (granularity === 'month') {
    const current = startOfUtcMonth(now);
    const first = addMonths(current, -11);
    return Array.from({ length: 12 }, (_, index) => addMonths(first, index));
  }

  const current = startOfUtcDay(now);
  const first = addDays(current, -29);
  return Array.from({ length: 30 }, (_, index) => addDays(first, index));
}

function toBucketStartIso(date, granularity) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    return '';
  }

  if (granularity === 'hour') {
    return startOfUtcHour(date).toISOString();
  }

  if (granularity === 'week') {
    return startOfUtcWeek(date).toISOString();
  }

  if (granularity === 'month') {
    return startOfUtcMonth(date).toISOString();
  }

  return startOfUtcDay(date).toISOString();
}

async function fetchUsageEventsForTimeseries(supabaseAdmin, startIso) {
  let from = 0;
  const rows = [];

  while (true) {
    const to = from + TIMESERIES_PAGE_SIZE - 1;
    const { data, error } = await supabaseAdmin
      .from('usage_events')
      .select('id,created_at,user_id')
      .gte('created_at', startIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      return { ok: false, error };
    }

    const pageRows = Array.isArray(data) ? data : [];
    if (pageRows.length === 0) {
      break;
    }

    rows.push(...pageRows);

    if (pageRows.length < TIMESERIES_PAGE_SIZE) {
      break;
    }

    from += TIMESERIES_PAGE_SIZE;
  }

  return { ok: true, rows };
}

function buildTimeseries(rows, granularity, bucketStarts) {
  const requestCounts = new Map();
  const uniqueUsersByBucket = new Map();

  const bucketKeys = bucketStarts.map((bucketDate) => bucketDate.toISOString());
  for (const bucketKey of bucketKeys) {
    requestCounts.set(bucketKey, 0);
    uniqueUsersByBucket.set(bucketKey, new Set());
  }

  for (const row of rows) {
    if (!isRecord(row) || typeof row.created_at !== 'string') {
      continue;
    }

    const createdAt = new Date(row.created_at);
    if (!Number.isFinite(createdAt.getTime())) {
      continue;
    }

    const bucketKey = toBucketStartIso(createdAt, granularity);
    if (!requestCounts.has(bucketKey)) {
      continue;
    }

    requestCounts.set(bucketKey, (requestCounts.get(bucketKey) ?? 0) + 1);
    if (typeof row.user_id === 'string' && row.user_id) {
      uniqueUsersByBucket.get(bucketKey)?.add(row.user_id);
    }
  }

  const timeseries = bucketKeys.map((bucketKey) => {
    const requests = requestCounts.get(bucketKey) ?? 0;
    const uniqueUsers = uniqueUsersByBucket.get(bucketKey)?.size ?? 0;
    return {
      bucketStart: bucketKey,
      requests,
      uniqueUsers
    };
  });

  const peakRequests = timeseries.reduce((max, row) => Math.max(max, row.requests), 0);
  return { timeseries, peakRequests };
}

async function fetchUserTierBreakdown(supabaseAdmin) {
  const breakdown = [];

  for (const tier of KNOWN_TIERS) {
    const { count, error } = await supabaseAdmin
      .from('profiles')
      .select('id', { head: true, count: 'exact' })
      .eq('account_type_id', tier);

    if (error) {
      return { ok: false, error };
    }

    breakdown.push({
      tier,
      users: typeof count === 'number' ? count : 0
    });
  }

  return { ok: true, breakdown };
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

function computeEstimatedCostsCents(usageRows) {
  const ttsCostPer1kChars = getTtsCostPer1kChars();
  let claudeCostUsd = 0;
  let ttsCostUsd = 0;

  for (const row of usageRows) {
    if (!isRecord(row)) {
      continue;
    }

    const inputTokens = Number(row.input_tokens ?? 0);
    const outputTokens = Number(row.output_tokens ?? 0);
    const ttsChars = Number(row.tts_chars ?? 0);

    claudeCostUsd += inputTokens * CLAUDE_INPUT_COST_PER_TOKEN;
    claudeCostUsd += outputTokens * CLAUDE_OUTPUT_COST_PER_TOKEN;
    ttsCostUsd += (ttsChars / 1000) * ttsCostPer1kChars;
  }

  return {
    estimatedClaudeCostCents: Math.round(claudeCostUsd * 100),
    estimatedTtsCostCents: Math.round(ttsCostUsd * 100),
    estimatedCostCents: Math.round((claudeCostUsd + ttsCostUsd) * 100)
  };
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

  const rawGranularity = typeof req.query?.granularity === 'string' ? req.query.granularity : 'day';
  const granularity = normalizeGranularity(rawGranularity);
  const bucketStarts = getTimeseriesBuckets(granularity);
  const timeseriesStartIso = bucketStarts[0]?.toISOString() ?? new Date(0).toISOString();

  try {
    const [usageResult, revenueResult, usageEventsResult, tierBreakdownResult] = await Promise.all([
      supabaseAdmin
        .from('admin_daily_usage')
        .select('*')
        .gte('day', periodStart.slice(0, 10)),
      supabaseAdmin
        .from('admin_revenue_summary')
        .select('*')
        .gte('month', periodStart.slice(0, 10)),
      fetchUsageEventsForTimeseries(supabaseAdmin, timeseriesStartIso),
      fetchUserTierBreakdown(supabaseAdmin)
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

    if (!usageEventsResult.ok) {
      console.error(`[api/admin-stats][${requestId}] Failed to query usage_events timeseries`, usageEventsResult.error);
      sendError(res, 500, usageEventsResult.error.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    if (!tierBreakdownResult.ok) {
      console.error(`[api/admin-stats][${requestId}] Failed to query profile tier counts`, tierBreakdownResult.error);
      sendError(res, 500, tierBreakdownResult.error.message, { code: 'SERVER_ERROR', requestId });
      return;
    }

    const dailyUsage = toCamelRows(usageResult.data ?? []);
    const revenue = toRevenueCamelRows(revenueResult.data ?? []);
    const costBreakdown = computeEstimatedCostsCents(usageResult.data ?? []);
    const totalRevenueCents = revenue.reduce((sum, row) => sum + row.totalCents, 0);
    const timeseries = buildTimeseries(usageEventsResult.rows, granularity, bucketStarts);

    res.status(200).json({
      ok: true,
      period,
      periodStart,
      granularity,
      dailyUsage,
      revenue,
      timeseries: timeseries.timeseries,
      peakRequests: timeseries.peakRequests,
      userTierBreakdown: tierBreakdownResult.breakdown,
      estimatedClaudeCostCents: costBreakdown.estimatedClaudeCostCents,
      estimatedTtsCostCents: costBreakdown.estimatedTtsCostCents,
      estimatedCostCents: costBreakdown.estimatedCostCents,
      totalRevenueCents
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    console.error(`[api/admin-stats][${requestId}] Unhandled error`, err);
    sendError(res, 500, message, { code: 'SERVER_ERROR', requestId });
  }
};
