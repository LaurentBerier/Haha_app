import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';
import { SENTRY_DSN } from '../config/env';

type SentryCaptureContext = {
  capture?: boolean;
  extra?: Record<string, unknown>;
  message?: string;
  requestId?: string;
  scope?: string;
  tags?: Record<string, string>;
};

let isInitialized = false;
let isDisabled = false;

function normalizeError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string' && error.trim()) {
    return new Error(error);
  }

  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown };
    const objectMessage = typeof candidate.message === 'string' && candidate.message.trim()
      ? candidate.message
      : fallbackMessage;
    return new Error(objectMessage);
  }

  return new Error(fallbackMessage);
}

export function initSentry(): boolean {
  if (isInitialized) {
    return true;
  }
  if (isDisabled) {
    return false;
  }

  const dsn = SENTRY_DSN.trim();
  if (!dsn) {
    isDisabled = true;
    return false;
  }

  const isDevRuntime = typeof __DEV__ !== 'undefined' && __DEV__;

  try {
    Sentry.init({
      dsn,
      environment: isDevRuntime ? 'development' : 'production',
      tracesSampleRate: isDevRuntime ? 0.2 : 0.1,
      enableNative: Platform.OS !== 'web'
    });
    isInitialized = true;
    return true;
  } catch {
    isDisabled = true;
    return false;
  }
}

export function captureAppException(error: unknown, context: SentryCaptureContext = {}): void {
  if (context.capture === false) {
    return;
  }
  if (!initSentry()) {
    return;
  }

  const normalized = normalizeError(error, context.message ?? 'Unhandled app error');
  Sentry.withScope((scope) => {
    if (typeof context.requestId === 'string' && context.requestId) {
      scope.setTag('request_id', context.requestId);
    }
    if (typeof context.scope === 'string' && context.scope) {
      scope.setTag('scope', context.scope);
    }
    if (context.tags && typeof context.tags === 'object') {
      for (const [key, value] of Object.entries(context.tags)) {
        if (typeof key === 'string' && key && typeof value === 'string' && value) {
          scope.setTag(key, value);
        }
      }
    }
    if (context.extra && typeof context.extra === 'object') {
      scope.setContext('extra', context.extra);
    }
    Sentry.captureException(normalized);
  });
}

export function __resetSentryForTests(): void {
  isInitialized = false;
  isDisabled = false;
}
