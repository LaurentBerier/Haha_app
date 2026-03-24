const Sentry = require('@sentry/node');

let isInitialized = false;
let isDisabled = false;

function getSentryDsn() {
  const dsn = process.env.SENTRY_DSN;
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
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      tracesSampleRate: 0.1
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
