import { t, type DictionaryKey } from '../i18n';

const ERROR_MESSAGE_KEYS = {
  generic: 'settingsGenericError',
  deleteAccount: 'settingsDeleteError',
  subscriptionCancel: 'settingsSubscriptionCancelErrorBody',
  subscriptionCheckout: 'settingsSubscriptionCheckoutErrorBody'
} as const satisfies Record<string, DictionaryKey>;

export type ErrorMessageCode = keyof typeof ERROR_MESSAGE_KEYS;

export function getErrorMessage(code: ErrorMessageCode): string {
  return t(ERROR_MESSAGE_KEYS[code]);
}

export function resolveErrorMessage(error: unknown, fallbackCode: ErrorMessageCode = 'generic'): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return getErrorMessage(fallbackCode);
}
