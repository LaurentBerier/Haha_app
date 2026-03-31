const { normalizeAccountType } = require('./_account-tier');

const DEFAULT_MONTHLY_CAPS = {
  free: 200,
  regular: 3_000,
  premium: 25_000
  // admin intentionally omitted => unlimited
};

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeInteger(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function getTierMonthlyCap(accountType) {
  const normalizedAccountType = normalizeAccountType(accountType);
  if (normalizedAccountType === 'admin') {
    return null;
  }

  const envKey = `CLAUDE_MONTHLY_CAP_${normalizedAccountType.toUpperCase()}`;
  const fromEnv = parsePositiveInt(process.env[envKey], 0);
  if (fromEnv > 0) {
    return fromEnv;
  }

  const cap = DEFAULT_MONTHLY_CAPS[normalizedAccountType];
  return cap ?? DEFAULT_MONTHLY_CAPS.free;
}

function getEffectiveMonthlyCap(accountType, monthlyCapOverride) {
  const override = toNonNegativeInteger(monthlyCapOverride);
  if (override !== null) {
    return override;
  }

  return getTierMonthlyCap(accountType);
}

function getRemainingMonthlyCredits(messagesUsed, effectiveCap) {
  if (effectiveCap === null || effectiveCap === undefined) {
    return null;
  }

  const normalizedUsed = toNonNegativeInteger(messagesUsed) ?? 0;
  return Math.max(0, effectiveCap - normalizedUsed);
}

module.exports = {
  DEFAULT_MONTHLY_CAPS,
  getEffectiveMonthlyCap,
  getRemainingMonthlyCredits,
  getTierMonthlyCap,
  parsePositiveInt
};
