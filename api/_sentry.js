const Sentry = require('@sentry/node');

let isInitialized = false;
let isDisabled = false;

function parseSampleRate(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

function getSentryDsn() {
  const dsn = process.env.SENTRY_DSN_API || process.env.SENTRY_DSN;
  return typeof dsn === 'string' && dsn.trim() ? dsn.trim() : '';
}

function initApiSentry() {
  if (isDisabled) {
    return false;
  }

  if (isInitialized) {
    return true;
  }

  const dsn = getSentryDsn();
  if (!dsn) {
    isDisabled = true;
    return false;
  }

  try {
    Sentry.init({
      dsn,
      environment:
        process.env.SENTRY_ENVIRONMENT ||
        process.env.VERCEL_ENV ||
        process.env.NODE_ENV ||
        'production',
      release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      tracesSampleRate: parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.1)
    });
    isInitialized = true;
    return true;
  } catch {
    isDisabled = true;
    return false;
  }
}

function normalizeError(error, fallbackMessage) {
  if (error instanceof Error) {
    return error;
  }

  const normalizedMessage =
    typeof fallbackMessage === 'string' && fallbackMessage.trim()
      ? fallbackMessage
      : typeof error === 'string'
        ? error
        : 'Unhandled API error';
  const wrapped = new Error(normalizedMessage);
  if (error && typeof error === 'object') {
    wrapped.cause = error;
  }
  return wrapped;
}

function captureApiException(error, context = {}) {
  if (!initApiSentry()) {
    return;
  }

  const normalized = normalizeError(error, context.message);
  Sentry.withScope((scope) => {
    if (typeof context.requestId === 'string' && context.requestId) {
      scope.setTag('request_id', context.requestId);
    }
    if (typeof context.scope === 'string' && context.scope) {
      scope.setTag('scope', context.scope);
    }
    if (context.extra && typeof context.extra === 'object') {
      scope.setContext('extra', context.extra);
    }
    Sentry.captureException(normalized);
  });
}

module.exports = {
  initApiSentry,
  captureApiException
};
