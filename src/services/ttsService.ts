import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { API_BASE_URL, CLAUDE_PROXY_URL } from '../config/env';

const MAX_TTS_INPUT_CHARS = 1000;
const TTS_ENDPOINT_TIMEOUT_MS = 10_000;
const WEB_TTS_CACHE = new Map<string, string>();
const WEB_TTS_CACHE_MAX_ENTRIES = 40;
const IN_FLIGHT_TTS_REQUESTS = new Map<string, Promise<string | null>>();
const TERMINAL_TTS_COOLDOWNS = new Map<
  string,
  {
    status: number;
    code: string;
    untilMs: number;
    retryAfterSeconds?: number;
  }
>();
const DEFAULT_TTS_RATE_LIMIT_COOLDOWN_MS = 60_000;
const DEFAULT_TTS_QUOTA_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_TTS_FORBIDDEN_COOLDOWN_MS = 2 * 60_000;
const DEFAULT_TTS_UNAUTHORIZED_COOLDOWN_MS = 30_000;
const EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC = process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC;
const EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY = process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY;
const VOICE_CACHE_VERSION = `${EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC ?? ''}|${EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY ?? ''}`;

interface FetchTtsResponse {
  ok: boolean;
  status: number;
  arrayBuffer?: ArrayBuffer;
  contentType?: string;
  code?: string;
  retryAfterSeconds?: number;
}

export type VoiceSynthesisPurpose = 'greeting' | 'reply';

export interface FetchVoiceOptions {
  purpose?: VoiceSynthesisPurpose;
  throwOnError?: boolean;
}

const KNOWN_TTS_ERROR_CODES = new Set([
  'TTS_QUOTA_EXCEEDED',
  'RATE_LIMIT_EXCEEDED',
  'TTS_FORBIDDEN',
  'TTS_PROVIDER_ERROR',
  'UNAUTHORIZED'
]);

function normalizeTtsErrorCode(status: number, code?: string | null): string {
  const normalizedCode = typeof code === 'string' ? code.trim() : '';
  if (normalizedCode && KNOWN_TTS_ERROR_CODES.has(normalizedCode)) {
    return normalizedCode;
  }

  if (status === 429) {
    return 'TTS_QUOTA_EXCEEDED';
  }
  if (status === 403) {
    return 'TTS_FORBIDDEN';
  }
  if (status === 401) {
    return 'UNAUTHORIZED';
  }
  return 'TTS_PROVIDER_ERROR';
}

function isTerminalTtsStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function extractApiErrorCode(response: Response): Promise<string | null> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    const payload = (await response.clone().json()) as {
      error?: { code?: unknown };
    };
    const code = payload?.error?.code;
    return typeof code === 'string' && code.trim() ? code.trim() : null;
  } catch {
    return null;
  }
}

function buildTtsError(status: number, code?: string): Error & { status: number; code: string; retryAfterSeconds?: number } {
  const error = new Error('TTS unavailable') as Error & { status: number; code: string; retryAfterSeconds?: number };
  error.status = status;
  error.code = normalizeTtsErrorCode(status, code);
  return error;
}

function buildTtsScopeKey(artistId: string, language: string, purpose: VoiceSynthesisPurpose, accessToken: string): string {
  return `${artistId}|${language.trim().toLowerCase()}|${purpose}|${hashString(accessToken.trim())}`;
}

function resolveTerminalCooldownMs(status: number, code: string, retryAfterSeconds?: number): number {
  if (typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  if (status === 429) {
    return code === 'TTS_QUOTA_EXCEEDED' ? DEFAULT_TTS_QUOTA_COOLDOWN_MS : DEFAULT_TTS_RATE_LIMIT_COOLDOWN_MS;
  }

  if (status === 403) {
    return DEFAULT_TTS_FORBIDDEN_COOLDOWN_MS;
  }

  if (status === 401) {
    return DEFAULT_TTS_UNAUTHORIZED_COOLDOWN_MS;
  }

  return DEFAULT_TTS_RATE_LIMIT_COOLDOWN_MS;
}

function writeTerminalCooldown(scopeKey: string, status: number, code: string, retryAfterSeconds?: number): void {
  if (!isTerminalTtsStatus(status)) {
    return;
  }

  const durationMs = resolveTerminalCooldownMs(status, code, retryAfterSeconds);
  const nowMs = Date.now();
  TERMINAL_TTS_COOLDOWNS.set(scopeKey, {
    status,
    code,
    untilMs: nowMs + durationMs,
    retryAfterSeconds
  });
}

function clearTerminalCooldown(scopeKey: string): void {
  TERMINAL_TTS_COOLDOWNS.delete(scopeKey);
}

export function clearTerminalCooldownForPurpose(
  artistId: string,
  language: string,
  purpose: VoiceSynthesisPurpose,
  accessToken: string
): void {
  const scopeKey = buildTtsScopeKey(artistId, language, purpose, accessToken);
  clearTerminalCooldown(scopeKey);
}

function readTerminalCooldown(scopeKey: string): {
  status: number;
  code: string;
  retryAfterSeconds: number;
} | null {
  const entry = TERMINAL_TTS_COOLDOWNS.get(scopeKey);
  if (!entry) {
    return null;
  }

  const remainingMs = entry.untilMs - Date.now();
  if (remainingMs <= 0) {
    TERMINAL_TTS_COOLDOWNS.delete(scopeKey);
    return null;
  }

  return {
    status: entry.status,
    code: entry.code,
    retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000))
  };
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function revokeWebObjectUrl(url: string): void {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    return;
  }
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Best effort cleanup.
  }
}

function readWebTtsCache(cacheKey: string): string | null {
  const cachedUrl = WEB_TTS_CACHE.get(cacheKey);
  if (!cachedUrl) {
    return null;
  }

  // Touch cache entry to preserve LRU ordering.
  WEB_TTS_CACHE.delete(cacheKey);
  WEB_TTS_CACHE.set(cacheKey, cachedUrl);
  return cachedUrl;
}

function writeWebTtsCache(cacheKey: string, blobUrl: string): void {
  const existingUrl = WEB_TTS_CACHE.get(cacheKey);
  if (existingUrl) {
    WEB_TTS_CACHE.delete(cacheKey);
    if (existingUrl !== blobUrl) {
      revokeWebObjectUrl(existingUrl);
    }
  }

  WEB_TTS_CACHE.set(cacheKey, blobUrl);

  while (WEB_TTS_CACHE.size > WEB_TTS_CACHE_MAX_ENTRIES) {
    const oldestKey = WEB_TTS_CACHE.keys().next().value;
    if (!oldestKey) {
      break;
    }
    const oldestUrl = WEB_TTS_CACHE.get(oldestKey);
    WEB_TTS_CACHE.delete(oldestKey);
    if (oldestUrl) {
      revokeWebObjectUrl(oldestUrl);
    }
  }
}

export function clearVoiceCacheOnSessionReset(): void {
  IN_FLIGHT_TTS_REQUESTS.clear();
  TERMINAL_TTS_COOLDOWNS.clear();
  if (WEB_TTS_CACHE.size === 0) {
    return;
  }
  for (const cachedUrl of WEB_TTS_CACHE.values()) {
    revokeWebObjectUrl(cachedUrl);
  }
  WEB_TTS_CACHE.clear();
}

export function clearTerminalTtsCooldowns(): void {
  TERMINAL_TTS_COOLDOWNS.clear();
}

export function buildTtsProxyCandidates(): string[] {
  const candidates: string[] = [];

  const addCandidate = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized) {
      return;
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  // Web first: try same-origin API routes before cross-origin backends.
  if (typeof window !== 'undefined' && typeof window.location?.origin === 'string' && window.location.origin) {
    const origin = normalizeUrl(window.location.origin);
    if (origin) {
      addCandidate(`${origin}/api/tts`);
    }
  }
  addCandidate('/api/tts');

  const apiBase = normalizeUrl(API_BASE_URL);
  if (apiBase) {
    addCandidate(`${apiBase}/tts`);
  }

  const claudeProxy = normalizeUrl(CLAUDE_PROXY_URL);
  if (claudeProxy) {
    addCandidate(claudeProxy.replace(/\/claude$/, '/tts'));
  }
  return candidates;
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function normalizeTtsText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= MAX_TTS_INPUT_CHARS) {
    return normalized;
  }

  return normalized.slice(0, MAX_TTS_INPUT_CHARS).trim();
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let index = 0;

  while (index < bytes.length) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;

    const triple = (a << 16) | (b << 8) | c;

    output += alphabet[(triple >> 18) & 0x3f] ?? 'A';
    output += alphabet[(triple >> 12) & 0x3f] ?? 'A';
    output += index + 1 < bytes.length ? alphabet[(triple >> 6) & 0x3f] ?? 'A' : '=';
    output += index + 2 < bytes.length ? alphabet[triple & 0x3f] ?? 'A' : '=';

    index += 3;
  }

  return output;
}

async function fetchTtsBinary(
  text: string,
  artistId: string,
  language: string,
  accessToken: string,
  options?: FetchVoiceOptions
): Promise<FetchTtsResponse> {
  const candidates = buildTtsProxyCandidates();
  const payload: {
    text: string;
    artistId: string;
    language: string;
    purpose?: VoiceSynthesisPurpose;
  } = {
    text,
    artistId,
    language
  };
  if (options?.purpose) {
    payload.purpose = options.purpose;
  }
  let lastStatus = 0;
  let lastCode: string | undefined;
  let lastRetryAfterSeconds: number | undefined;

  for (const endpoint of candidates) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutHandle = setTimeout(() => {
      controller?.abort();
    }, TTS_ENDPOINT_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller?.signal
      });

      if (!response.ok) {
        const responseCode = await extractApiErrorCode(response);
        const normalizedCode = normalizeTtsErrorCode(response.status, responseCode);
        const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('retry-after'));
        lastStatus = response.status;
        lastCode = normalizedCode;
        lastRetryAfterSeconds = retryAfterSeconds;
        if (isTerminalTtsStatus(response.status)) {
          return {
            ok: false,
            status: response.status,
            code: normalizedCode,
            retryAfterSeconds
          };
        }
        continue;
      }

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (!contentType.includes('audio/')) {
        lastStatus = response.status;
        lastCode = normalizeTtsErrorCode(response.status);
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      return {
        ok: true,
        status: response.status,
        arrayBuffer,
        contentType
      };
    } catch {
      // Try next candidate.
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  return {
    ok: false,
    status: lastStatus,
    code: lastCode,
    retryAfterSeconds: lastRetryAfterSeconds
  };
}

function buildCacheKey(text: string, artistId: string, language: string, purpose: VoiceSynthesisPurpose): string {
  return hashString(`${artistId}|${language}|${purpose}|${VOICE_CACHE_VERSION}|${text}`);
}

export async function fetchAndCacheVoice(
  text: string,
  artistId: string,
  language: string,
  accessToken: string,
  options?: FetchVoiceOptions
): Promise<string | null> {
  const normalizedText = normalizeTtsText(text);
  const normalizedArtistId = artistId.trim();
  const normalizedAccessToken = accessToken.trim();
  const purpose = options?.purpose ?? 'reply';
  if (!normalizedText || !normalizedArtistId || !normalizedAccessToken) {
    return null;
  }

  const cacheKey = buildCacheKey(normalizedText, normalizedArtistId, language.trim(), purpose);
  const scopeKey = buildTtsScopeKey(normalizedArtistId, language, purpose, normalizedAccessToken);
  const inFlightKey = `${Platform.OS}|${cacheKey}|${hashString(normalizedAccessToken)}`;

  if (Platform.OS === 'web') {
    const cachedUrl = readWebTtsCache(cacheKey);
    if (cachedUrl) {
      return cachedUrl;
    }
  }

  const existingInFlight = IN_FLIGHT_TTS_REQUESTS.get(inFlightKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const requestPromise = (async (): Promise<string | null> => {
    const blocked = readTerminalCooldown(scopeKey);
    if (blocked) {
      if (options?.throwOnError) {
        const error = buildTtsError(blocked.status, blocked.code);
        error.retryAfterSeconds = blocked.retryAfterSeconds;
        throw error;
      }
      return null;
    }

    if (Platform.OS === 'web') {
      const response = await fetchTtsBinary(normalizedText, normalizedArtistId, language, normalizedAccessToken, options);
      if (!response.ok || !response.arrayBuffer) {
        if (isTerminalTtsStatus(response.status)) {
          writeTerminalCooldown(
            scopeKey,
            response.status,
            normalizeTtsErrorCode(response.status, response.code),
            response.retryAfterSeconds
          );
        }
        if (options?.throwOnError) {
          const error = buildTtsError(response.status, response.code);
          error.retryAfterSeconds = response.retryAfterSeconds;
          throw error;
        }
        return null;
      }

      clearTerminalCooldown(scopeKey);
      const blob = new Blob([response.arrayBuffer], { type: 'audio/mpeg' });
      const blobUrl = URL.createObjectURL(blob);
      writeWebTtsCache(cacheKey, blobUrl);
      return blobUrl;
    }

    if (!FileSystem.cacheDirectory) {
      return null;
    }

    const cacheUri = `${FileSystem.cacheDirectory}tts_${cacheKey}.mp3`;

    try {
      const info = await FileSystem.getInfoAsync(cacheUri);
      if (info.exists) {
        return cacheUri;
      }
    } catch {
      // Continue with fetch.
    }

    const response = await fetchTtsBinary(normalizedText, normalizedArtistId, language, normalizedAccessToken, options);
    if (!response.ok || !response.arrayBuffer) {
      if (isTerminalTtsStatus(response.status)) {
        writeTerminalCooldown(
          scopeKey,
          response.status,
          normalizeTtsErrorCode(response.status, response.code),
          response.retryAfterSeconds
        );
      }
      if (options?.throwOnError) {
        const error = buildTtsError(response.status, response.code);
        error.retryAfterSeconds = response.retryAfterSeconds;
        throw error;
      }
      return null;
    }

    clearTerminalCooldown(scopeKey);
    const base64 = bytesToBase64(new Uint8Array(response.arrayBuffer));

    await FileSystem.writeAsStringAsync(cacheUri, base64, {
      encoding: FileSystem.EncodingType.Base64
    });

    return cacheUri;
  })();

  IN_FLIGHT_TTS_REQUESTS.set(inFlightKey, requestPromise);
  return requestPromise.finally(() => {
    if (IN_FLIGHT_TTS_REQUESTS.get(inFlightKey) === requestPromise) {
      IN_FLIGHT_TTS_REQUESTS.delete(inFlightKey);
    }
  });
}
