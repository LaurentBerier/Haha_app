/**
 * Cross-cutting auth + navigation ordering expectations.
 *
 * Invariants:
 * - `/auth/callback` must complete PKCE / OTP / hash-token exchange without being redirected to
 *   `/(auth)/login` by the root auth gate (unauthenticated users stay on callback until
 *   resolution or error UI).
 * - `useAuth` bootstrap uses a monotonic run id so stale async work never overwrites session.
 * - Account switch: local conversation state is cleared when `persistedOwnerUserId` or session
 *   user id changes and local chat data exists (see authSlice + useAuth).
 */

/** Routes where layout auth gate must not force login while callback UI is active. */
export const AUTH_CALLBACK_SEGMENT = 'auth/callback' as const;
