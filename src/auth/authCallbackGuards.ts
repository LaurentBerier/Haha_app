/**
 * Pure guards for auth callback URL handling (testable without mounting the screen).
 */

export function isDuplicateAuthCallbackUrl(callbackUrl: string | null, lastHandledUrl: string | null): boolean {
  return Boolean(callbackUrl && lastHandledUrl === callbackUrl);
}

/**
 * When true, the handler should return early and must not clear error state or re-enter loading.
 */
export function shouldShortCircuitDuplicateAuthCallback(
  callbackUrl: string | null,
  lastHandledUrl: string | null
): boolean {
  return isDuplicateAuthCallbackUrl(callbackUrl, lastHandledUrl);
}
