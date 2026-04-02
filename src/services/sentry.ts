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
const RANGE_SELECT_NODE_NO_PARENT_ERROR = "failed to execute 'selectnode' on 'range': the given node has no parent.";
const NULL_REMOVE_EVENT_LISTENER_ERROR = "cannot read properties of null (reading 'removeeventlistener')";
const BROWSER_API_ERRORS_INTEGRATION_NAME = 'browserapierrors';

type SentryExceptionFrame = {
  filename?: string;
};

type SentryExceptionValue = {
  stacktrace?: {
    frames?: SentryExceptionFrame[];
  };
  type?: string;
  value?: string;
};

type SentryLikeEvent = {
  exception?: {
    values?: SentryExceptionValue[];
  };
  message?: string;
};

type SentryInitOptions = Parameters<typeof Sentry.init>[0];
type SentryIntegrationsOption = NonNullable<SentryInitOptions['integrations']>;
type SentryIntegrationsResolver = Exclude<SentryIntegrationsOption, unknown[]>;
type SentryDefaultIntegrations = Parameters<SentryIntegrationsResolver>[0];
type SentryDefaultIntegration = SentryDefaultIntegrations[number];

function normalizeErrorText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasInstrumentationFrame(exception: SentryExceptionValue | null): boolean {
  if (!exception?.stacktrace?.frames) {
    return false;
  }

  return exception.stacktrace.frames.some((frame) => {
    const filename = normalizeErrorText(frame.filename);
    return (
      filename.includes('app:///instrument') ||
      filename.includes('/instrument.') ||
      filename.startsWith('instrument.')
    );
  });
}

function shouldDropKnownWebInstrumentationNoise(event: unknown): boolean {
  if (!event || typeof event !== 'object') {
    return false;
  }

  const candidateEvent = event as SentryLikeEvent;
  const exception = candidateEvent.exception?.values?.[0] ?? null;
  const exceptionValue = normalizeErrorText(exception?.value);
  const exceptionType = normalizeErrorText(exception?.type);
  const eventMessage = normalizeErrorText(candidateEvent.message);
  const combinedMessage = `${exceptionType}: ${exceptionValue} ${eventMessage}`.trim();

  if (
    exceptionValue.includes(RANGE_SELECT_NODE_NO_PARENT_ERROR) ||
    combinedMessage.includes(RANGE_SELECT_NODE_NO_PARENT_ERROR)
  ) {
    return true;
  }

  if (
    (exceptionValue.includes(NULL_REMOVE_EVENT_LISTENER_ERROR) ||
      combinedMessage.includes(NULL_REMOVE_EVENT_LISTENER_ERROR)) &&
    hasInstrumentationFrame(exception)
  ) {
    return true;
  }

  return false;
}

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
  const resolveWebIntegrations: SentryIntegrationsResolver = (defaultIntegrations: SentryDefaultIntegrations) => {
    const filteredDefaultIntegrations = defaultIntegrations.filter((integration: SentryDefaultIntegration) => {
      const integrationName = normalizeErrorText(integration.name);
      return integrationName !== BROWSER_API_ERRORS_INTEGRATION_NAME;
    });

    return [
      ...filteredDefaultIntegrations,
      Sentry.browserReplayIntegration({
        // Keep replay internals from escalating into additional capture paths.
        _experiments: { captureExceptions: false },
        // Avoid triggering replay-on-error sampling for known instrumentation noise.
        beforeErrorSampling: (event) => !shouldDropKnownWebInstrumentationNoise(event)
      })
    ];
  };

  const webOptions =
    Platform.OS === 'web'
      ? {
          integrations: resolveWebIntegrations,
          replaysSessionSampleRate: isDevRuntime ? 1.0 : 0.1,
          replaysOnErrorSampleRate: 1.0
        }
      : {};

  try {
    Sentry.init({
      dsn,
      environment: isDevRuntime ? 'development' : 'production',
      tracesSampleRate: isDevRuntime ? 0.2 : 0.1,
      sendDefaultPii: true,
      enableNative: Platform.OS !== 'web',
      beforeSend: (event) => {
        if (Platform.OS === 'web' && shouldDropKnownWebInstrumentationNoise(event)) {
          return null;
        }

        return event;
      },
      ...webOptions
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
