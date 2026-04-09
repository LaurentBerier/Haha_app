const { normalizeAccountType } = require('./_account-tier');
const { getEffectiveMonthlyCap } = require('./_monthly-cap');

const PROGRESSIVE_THRESHOLDS = {
  HAIKU: 0.65,
  SOFT2: 0.8,
  SOFT3: 0.92,
  HARD: 1,
  ABSOLUTE: 1.5
};

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function isMissingMonthlyCounterColumnError(error) {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
  if (code === '42703') {
    return true;
  }

  const message = isRecord(error) && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return message.includes('monthly_message_count') || message.includes('monthly_reset_at');
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
    console.error(`[api/_quota-status][${requestId}] Failed to read profile monthly counter`, error);
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
        : 0
  };
}

async function computeQuotaRatioForUser(supabaseAdmin, userId, accountType, requestId) {
  const normalizedAccountType = normalizeAccountType(accountType);
  if (normalizedAccountType === 'admin') {
    return {
      ok: true,
      ratio: 0,
      used: 0,
      effectiveCap: null
    };
  }

  let override = null;
  const { data: profileOverride, error: overrideError } = await supabaseAdmin
    .from('profiles')
    .select('monthly_cap_override')
    .eq('id', userId)
    .maybeSingle();
  if (overrideError) {
    console.error(`[api/_quota-status][${requestId}] Failed to read monthly cap override`, overrideError);
  } else if (profileOverride && typeof profileOverride.monthly_cap_override === 'number') {
    override = profileOverride.monthly_cap_override;
  }

  const effectiveCap = getEffectiveMonthlyCap(normalizedAccountType, override);
  const counterResult = await readProfileMonthlyCounter(supabaseAdmin, userId, requestId);
  if (!counterResult.ok) {
    return { ok: false, ratio: 0, used: 0, effectiveCap };
  }

  const used = counterResult.unsupported ? 0 : counterResult.monthlyMessageCount;
  const ratio = typeof effectiveCap === 'number' && effectiveCap > 0 ? used / effectiveCap : 0;
  return {
    ok: true,
    ratio,
    used,
    effectiveCap
  };
}

function isExpensiveModesAllowed(ratio) {
  return ratio < PROGRESSIVE_THRESHOLDS.SOFT2;
}

function isTtsMessageQuotaAllowed(ratio) {
  return ratio < PROGRESSIVE_THRESHOLDS.SOFT3;
}

module.exports = {
  PROGRESSIVE_THRESHOLDS,
  computeQuotaRatioForUser,
  isExpensiveModesAllowed,
  isTtsMessageQuotaAllowed
};
