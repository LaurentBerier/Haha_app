/**
 * Engineering contracts for Conversation Naturelle (Phase 4).
 * Keep in sync with docs/phase4-status.md — these are the non-negotiable invariants.
 */

/** Silence duration (ms) before auto-send when STT is idle; override via EXPO_PUBLIC_SILENCE_TIMEOUT_MS. */
export const DEFAULT_SILENCE_AUTO_SEND_MS = 1800;
export const MIN_SILENCE_AUTO_SEND_MS = 1200;

/** Assistant busy / loading window before treating STT as stalled; override via EXPO_PUBLIC_BUSY_LOADING_TIMEOUT_MS. */
export const DEFAULT_BUSY_LOADING_TIMEOUT_MS = 12000;
export const MIN_BUSY_LOADING_TIMEOUT_MS = 3000;

/** Mic / capture recovery backoff steps; after exhaustion → paused_recovery until user action. */
export const VOICE_RECOVERY_DELAYS_MS = [250, 800, 2000] as const;

/** Greeting bootstrap: max time to wait on API before deterministic fallback (mode-select). */
export const GREETING_GLOBAL_RETRY_BUDGET_MS = 25_000;

/** Env keys (documented in README / phase4). */
export const ENV_SILENCE_TIMEOUT_MS = 'EXPO_PUBLIC_SILENCE_TIMEOUT_MS';
export const ENV_BUSY_LOADING_TIMEOUT_MS = 'EXPO_PUBLIC_BUSY_LOADING_TIMEOUT_MS';
