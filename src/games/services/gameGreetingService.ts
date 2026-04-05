import { API_BASE_URL, CLAUDE_PROXY_URL } from '../../config/env';

export interface FetchGameGreetingFromApiParams {
  artistId: string;
  language: string;
  accessToken: string;
  preferredName?: string | null;
  recentExperienceName?: string | null;
}

const GREETING_API_BACKOFF_MS = 5 * 60_000;
const GREETING_API_REQUEST_TIMEOUT_MS = 12_000;
const GREETING_API_MAX_ATTEMPTS = 2;
const GREETING_API_RETRY_DELAY_MS = 850;

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

function shouldSkipGreetingApiCall(nowTs = Date.now()): boolean {
  if (isLocalWebHost()) {
    return true;
  }

  return nowTs < greetingApiBackoffUntilTs;
}

function markGreetingApiBackoff(nowTs = Date.now()): void {
  greetingApiBackoffUntilTs = nowTs + GREETING_API_BACKOFF_MS;
}

function clearGreetingApiBackoff(): void {
  greetingApiBackoffUntilTs = 0;
}

function buildGreetingEndpointCandidates(): string[] {
  const isWebRuntime = typeof window !== 'undefined';
  const candidates: string[] = [];
  const addCandidate = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized) {
      return;
    }
    if (!isWebRuntime && normalized.startsWith('/')) {
      return;
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
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

interface GreetingEndpointResponse {
  greeting?: unknown;
}

export async function fetchGameGreetingFromApi(params: FetchGameGreetingFromApiParams): Promise<string | null> {
  const token = params.accessToken.trim();
  if (!token || shouldSkipGreetingApiCall()) {
    return null;
  }

  const payload: Record<string, unknown> = {
    artistId: params.artistId,
    language: params.language,
    availableModes: [],
    isSessionFirstGreeting: false,
    recentExperienceType: 'game'
  };

  const normalizedExperienceName =
    typeof params.recentExperienceName === 'string' ? params.recentExperienceName.trim() : '';
  if (normalizedExperienceName) {
    payload.recentExperienceName = normalizedExperienceName.slice(0, 80);
  }

  const normalizedPreferredName = typeof params.preferredName === 'string' ? params.preferredName.trim() : '';
  if (normalizedPreferredName) {
    payload.preferredName = normalizedPreferredName.slice(0, 40);
  }

  const candidates = buildGreetingEndpointCandidates();
  if (candidates.length === 0) {
    return null;
  }

  let shouldBackoff = false;

  for (let attempt = 0; attempt < GREETING_API_MAX_ATTEMPTS; attempt += 1) {
    for (const endpoint of candidates) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), GREETING_API_REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(endpoint, {
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
            return null;
          }
          if (response.status >= 500) {
            shouldBackoff = true;
          }
          continue;
        }

        const data = (await response.json()) as GreetingEndpointResponse;
        const greeting = typeof data.greeting === 'string' ? data.greeting.trim() : '';
        if (greeting) {
          clearGreetingApiBackoff();
          return greeting;
        }
      } catch {
        shouldBackoff = true;
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    if (attempt < GREETING_API_MAX_ATTEMPTS - 1) {
      await delay(GREETING_API_RETRY_DELAY_MS);
    }
  }

  if (shouldBackoff) {
    markGreetingApiBackoff();
  }

  return null;
}

export function __resetGameGreetingApiBackoffForTest(): void {
  clearGreetingApiBackoff();
}
