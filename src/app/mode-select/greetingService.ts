import { GREETING_GLOBAL_RETRY_BUDGET_MS } from '../../contracts/conversationContracts';
import { API_BASE_URL, CLAUDE_PROXY_URL, GREETING_FORCE_TUTORIAL } from '../../config/env';

export interface GreetingCoordinates {
  lat: number;
  lon: number;
}

export interface GreetingTutorialInfo {
  active: boolean;
  sessionIndex: number;
  connectionLimit: number;
}

export interface GreetingFetchResult {
  greeting: string | null;
  tutorial: GreetingTutorialInfo | null;
  timedOut: boolean;
}

export interface FetchModeSelectGreetingParams {
  artistId: string;
  language: string;
  accessToken: string;
  coords: GreetingCoordinates | null;
  availableModes: string[];
  preferredName: string | null;
  isSessionFirstGreeting: boolean;
  memoryFacts?: string[];
  recentActivityFacts?: string[];
  askActivityFeedback?: boolean;
  lastGreetingSnippet?: string | null;
  recentExperienceName?: string | null;
  recentExperienceType?: 'mode' | 'game' | null;
  activityFeedbackCue?: string | null;
}

export interface FetchModeSelectGreetingOverrides {
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  requestTimeoutMs?: number;
  retryBaseDelayMs?: number;
  totalBudgetMs?: number;
  onTrace?: (event: string, payload?: Record<string, unknown>) => void;
}

interface GreetingEndpointResponse {
  greeting?: unknown;
  tutorial?: unknown;
}

const GREETING_API_BACKOFF_MS = 5 * 60_000;
const GREETING_API_REQUEST_TIMEOUT_MS = 12_000;
const GREETING_API_RETRY_BASE_DELAY_MS = 850;
const GREETING_API_TOTAL_BUDGET_MS = GREETING_GLOBAL_RETRY_BUDGET_MS;
const GREETING_API_MAX_ATTEMPT_ROUNDS = 12;
const MAX_RETRY_DELAY_MS = 6_000;
const MIN_REQUEST_TIMEOUT_MS = 250;
const DEFAULT_TUTORIAL_CONNECTION_LIMIT = 1;

let greetingApiBackoffUntilTs = 0;

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function isLocalWebHost(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const host = window.location.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1';
}

function shouldSkipGreetingApiCall(nowTs: number): boolean {
  if (isLocalWebHost()) {
    return true;
  }

  return nowTs < greetingApiBackoffUntilTs;
}

function markGreetingApiBackoff(nowTs: number): void {
  greetingApiBackoffUntilTs = nowTs + GREETING_API_BACKOFF_MS;
}

function clearGreetingApiBackoff(): void {
  greetingApiBackoffUntilTs = 0;
}

function buildGreetingEndpointCandidates(): string[] {
  const isWebRuntime = typeof window !== 'undefined';
  const candidates: string[] = [];
  const seen = new Set<string>();

  const canonicalizeCandidate = (candidate: string): string | null => {
    const normalized = candidate.trim();
    if (!normalized) {
      return null;
    }

    if (!isWebRuntime) {
      return normalized;
    }

    if (typeof window.location?.origin !== 'string' || !window.location.origin) {
      return normalized;
    }

    try {
      return new URL(normalized, window.location.origin).toString();
    } catch {
      return normalized;
    }
  };

  const addCandidate = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized) {
      return;
    }
    if (!isWebRuntime && normalized.startsWith('/')) {
      return;
    }
    const canonicalCandidate = canonicalizeCandidate(normalized);
    if (!canonicalCandidate || seen.has(canonicalCandidate)) {
      return;
    }
    seen.add(canonicalCandidate);
    candidates.push(canonicalCandidate);
  };

  if (isWebRuntime && typeof window.location?.origin === 'string' && window.location.origin) {
    const origin = normalizeUrl(window.location.origin);
    if (origin) {
      addCandidate(`${origin}/api/greeting`);
    }
    addCandidate('/api/greeting');
  }

  const apiBase = normalizeUrl(API_BASE_URL);
  if (apiBase) {
    addCandidate(`${apiBase}/greeting`);
  }

  const claudeProxy = normalizeUrl(CLAUDE_PROXY_URL);
  if (claudeProxy) {
    addCandidate(claudeProxy.replace(/\/claude$/, '/greeting'));
  }
  return candidates;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseGreetingTutorialInfo(value: unknown): GreetingTutorialInfo | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const active = raw.active === true;
  const sessionIndex = typeof raw.sessionIndex === 'number' && Number.isFinite(raw.sessionIndex)
    ? Math.max(0, Math.floor(raw.sessionIndex))
    : 0;
  const connectionLimit =
    typeof raw.connectionLimit === 'number' && Number.isFinite(raw.connectionLimit)
      ? Math.max(1, Math.floor(raw.connectionLimit))
      : DEFAULT_TUTORIAL_CONNECTION_LIMIT;

  return {
    active,
    sessionIndex,
    connectionLimit
  };
}

function sanitizeRecentActivityFacts(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 2);
}

function sanitizeMemoryFacts(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function clampPositiveMs(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

export async function fetchModeSelectGreetingFromApi(
  params: FetchModeSelectGreetingParams,
  overrides: FetchModeSelectGreetingOverrides = {}
): Promise<GreetingFetchResult> {
  if (GREETING_FORCE_TUTORIAL) {
    return {
      greeting: null,
      tutorial: null,
      timedOut: false
    };
  }

  const token = params.accessToken.trim();
  const nowMs = overrides.nowMs ?? Date.now;
  const nowTs = nowMs();
  if (!token || shouldSkipGreetingApiCall(nowTs)) {
    return {
      greeting: null,
      tutorial: null,
      timedOut: false
    };
  }

  const payload: Record<string, unknown> = {
    artistId: params.artistId,
    language: params.language,
    availableModes: params.availableModes,
    isSessionFirstGreeting: params.isSessionFirstGreeting
  };

  const memoryFacts = sanitizeMemoryFacts(params.memoryFacts);
  if (memoryFacts.length > 0) {
    payload.memoryFacts = memoryFacts;
  }

  const recentActivityFacts = sanitizeRecentActivityFacts(params.recentActivityFacts);
  if (recentActivityFacts.length > 0) {
    payload.recentActivityFacts = recentActivityFacts;
  }
  if (params.askActivityFeedback === true) {
    payload.askActivityFeedback = true;
  }
  if (typeof params.lastGreetingSnippet === 'string' && params.lastGreetingSnippet.trim()) {
    payload.lastGreetingSnippet = params.lastGreetingSnippet.trim().slice(0, 180);
  }
  if (typeof params.recentExperienceName === 'string' && params.recentExperienceName.trim()) {
    payload.recentExperienceName = params.recentExperienceName.trim().slice(0, 80);
  }
  if (params.recentExperienceType === 'mode' || params.recentExperienceType === 'game') {
    payload.recentExperienceType = params.recentExperienceType;
  }
  if (typeof params.activityFeedbackCue === 'string' && params.activityFeedbackCue.trim()) {
    payload.activityFeedbackCue = params.activityFeedbackCue.trim().slice(0, 180);
  }
  if (params.preferredName) {
    payload.preferredName = params.preferredName;
  }
  if (params.coords) {
    payload.coords = params.coords;
  }

  const candidates = buildGreetingEndpointCandidates();
  if (candidates.length === 0) {
    return {
      greeting: null,
      tutorial: null,
      timedOut: false
    };
  }

  const fetchImpl = overrides.fetchImpl ?? fetch;
  const sleep = overrides.sleep ?? delay;
  const requestTimeoutMs = clampPositiveMs(overrides.requestTimeoutMs, GREETING_API_REQUEST_TIMEOUT_MS);
  const retryBaseDelayMs = clampPositiveMs(overrides.retryBaseDelayMs, GREETING_API_RETRY_BASE_DELAY_MS);
  const totalBudgetMs = clampPositiveMs(overrides.totalBudgetMs, GREETING_API_TOTAL_BUDGET_MS);
  const deadlineTs = nowTs + totalBudgetMs;
  const trace = overrides.onTrace;

  let shouldBackoff = false;
  let timedOut = false;

  for (let round = 0; round < GREETING_API_MAX_ATTEMPT_ROUNDS; round += 1) {
    const remainingBudgetAtRoundStart = deadlineTs - nowMs();
    if (remainingBudgetAtRoundStart <= 0) {
      timedOut = true;
      break;
    }
    trace?.('retry_round_start', {
      round: round + 1,
      remainingBudgetMs: remainingBudgetAtRoundStart
    });

    for (const endpoint of candidates) {
      const remainingBudgetMs = deadlineTs - nowMs();
      if (remainingBudgetMs <= 0) {
        timedOut = true;
        break;
      }

      const timeoutForRequestMs = Math.max(
        MIN_REQUEST_TIMEOUT_MS,
        Math.min(requestTimeoutMs, remainingBudgetMs)
      );
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutForRequestMs);

      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (!response.ok) {
          if (response.status === 401) {
            // Token is invalid — no point retrying any endpoint.
            return { greeting: null, tutorial: null, timedOut: false };
          }
          if (response.status >= 500) {
            shouldBackoff = true;
          }
          trace?.('retry_http_error', {
            endpoint,
            status: response.status,
            round: round + 1
          });
          continue;
        }

        const data = (await response.json()) as GreetingEndpointResponse;
        const greeting = typeof data.greeting === 'string' ? data.greeting.trim() : '';
        if (greeting) {
          clearGreetingApiBackoff();
          return {
            greeting,
            tutorial: parseGreetingTutorialInfo(data.tutorial),
            timedOut: false
          };
        }
      } catch {
        shouldBackoff = true;
        trace?.('retry_network_error', {
          endpoint,
          round: round + 1
        });
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    if (timedOut) {
      break;
    }

    if (round >= GREETING_API_MAX_ATTEMPT_ROUNDS - 1) {
      break;
    }

    const remainingBudgetMs = deadlineTs - nowMs();
    if (remainingBudgetMs <= 0) {
      timedOut = true;
      break;
    }
    const retryDelayMs = Math.min(
      retryBaseDelayMs * 2 ** round,
      MAX_RETRY_DELAY_MS,
      remainingBudgetMs
    );
    if (retryDelayMs <= 0) {
      continue;
    }
    trace?.('retry_wait', {
      round: round + 1,
      delayMs: retryDelayMs
    });
    await sleep(retryDelayMs);
  }

  if (!timedOut && nowMs() >= deadlineTs) {
    timedOut = true;
  }

  if (shouldBackoff) {
    markGreetingApiBackoff(nowMs());
  }

  if (timedOut) {
    trace?.('retry_budget_timeout', {
      totalBudgetMs
    });
  }

  return {
    greeting: null,
    tutorial: null,
    timedOut
  };
}

export function __resetModeSelectGreetingApiBackoffForTest(): void {
  clearGreetingApiBackoff();
}
