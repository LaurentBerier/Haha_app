const DEFAULT_MONTHLY_CAPS = {
  free: 50,
  regular: 500,
  premium: 1500
  // admin intentionally omitted => unlimited
};

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

async function readProfileMonthlyCounter(supabaseAdmin, userId, requestId, logPrefix) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('monthly_message_count, monthly_reset_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    if (isMissingMonthlyCounterColumnError(error)) {
      return { ok: true, unsupported: true };
    }

    console.error(`[${logPrefix}][${requestId}] Failed to read profile monthly counter`, error);
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

async function writeProfileMonthlyCounter(supabaseAdmin, userId, monthStartIso, nextCount, requestId, logPrefix) {
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

    console.error(`[${logPrefix}][${requestId}] Failed to write profile monthly counter`, error);
    return { ok: false, error };
  }

  return { ok: true, unsupported: false };
}

async function enforceMonthlyQuota({
  supabaseAdmin,
  userId,
  accountType,
  requestId,
  logPrefix,
  usageEndpoints
}) {
  const normalizedAccountType = typeof accountType === 'string' && accountType.trim() ? accountType.trim() : 'free';
  if (normalizedAccountType === 'admin') {
    return { ok: true, source: 'admin', monthStartIso: getMonthStartIso(), used: 0 };
  }

  const effectiveCap = getMonthlyCap(normalizedAccountType);
  const monthStartIso = getMonthStartIso();

  const profileCounter = await readProfileMonthlyCounter(supabaseAdmin, userId, requestId, logPrefix);
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
    .in('endpoint', usageEndpoints)
    .gte('created_at', monthStartIso);

  if (error) {
    console.error(`[${logPrefix}][${requestId}] Failed to read monthly usage`, error);
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

async function recordUsageEvent({ supabaseAdmin, userId, endpoint, requestId }) {
  const nowIso = new Date().toISOString();
  const insertPayload = {
    user_id: userId,
    endpoint,
    request_id: requestId,
    created_at: nowIso
  };

  let { error } = await supabaseAdmin.from('usage_events').insert(insertPayload);
  if (error && isMissingUsageEventsRequestIdColumn(error)) {
    const fallbackPayload = {
      user_id: userId,
      endpoint,
      created_at: nowIso
    };
    ({ error } = await supabaseAdmin.from('usage_events').insert(fallbackPayload));
  }

  if (error) {
    return { ok: false, error };
  }

  return { ok: true };
}

module.exports = {
  enforceMonthlyQuota,
  getRetryAfterUntilNextMonthSeconds,
  recordUsageEvent,
  writeProfileMonthlyCounter
};
