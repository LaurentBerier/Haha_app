import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { API_BASE_URL, CLAUDE_PROXY_URL } from '../config/env';

const MAX_TTS_INPUT_CHARS = 1000;
const WEB_TTS_CACHE = new Map<string, string>();
const EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC = process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC;
const EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY = process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY;
const VOICE_CACHE_VERSION = `${EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC ?? ''}|${EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY ?? ''}`;

interface FetchTtsResponse {
  ok: boolean;
  status: number;
  arrayBuffer?: ArrayBuffer;
  contentType?: string;
}

export type VoiceSynthesisPurpose = 'greeting' | 'reply';

export interface FetchVoiceOptions {
  purpose?: VoiceSynthesisPurpose;
  throwOnError?: boolean;
}

function buildTtsError(status: number): Error & { status: number; code: string } {
  const error = new Error('TTS unavailable') as Error & { status: number; code: string };
  error.status = status;
  error.code = status === 429 ? 'TTS_QUOTA_EXCEEDED' : status === 403 ? 'TTS_FORBIDDEN' : 'TTS_UNAVAILABLE';
  return error;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function buildTtsProxyCandidates(): string[] {
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

  const apiBase = normalizeUrl(API_BASE_URL);
  if (apiBase) {
    addCandidate(`${apiBase}/tts`);
  }

  const claudeProxy = normalizeUrl(CLAUDE_PROXY_URL);
  if (claudeProxy) {
    addCandidate(claudeProxy.replace(/\/claude$/, '/tts'));
  }

  if (typeof window !== 'undefined' && typeof window.location?.origin === 'string' && window.location.origin) {
    const origin = normalizeUrl(window.location.origin);
    if (origin) {
      addCandidate(`${origin}/api/tts`);
    }
  }

  addCandidate('/api/tts');
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

  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        lastStatus = response.status;
        continue;
      }

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (!contentType.includes('audio/')) {
        lastStatus = response.status;
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
    }
  }

  return {
    ok: false,
    status: lastStatus
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
  const purpose = options?.purpose ?? 'reply';
  if (!normalizedText || !normalizedArtistId || !accessToken.trim()) {
    return null;
  }

  const cacheKey = buildCacheKey(normalizedText, normalizedArtistId, language.trim(), purpose);

  if (Platform.OS === 'web') {
    const cachedUrl = WEB_TTS_CACHE.get(cacheKey);
    if (cachedUrl) {
      return cachedUrl;
    }

    const response = await fetchTtsBinary(normalizedText, normalizedArtistId, language, accessToken, options);
    if (!response.ok || !response.arrayBuffer) {
      if (options?.throwOnError) {
        throw buildTtsError(response.status);
      }
      return null;
    }

    const blob = new Blob([response.arrayBuffer], { type: 'audio/mpeg' });
    const blobUrl = URL.createObjectURL(blob);
    WEB_TTS_CACHE.set(cacheKey, blobUrl);
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

  const response = await fetchTtsBinary(normalizedText, normalizedArtistId, language, accessToken, options);
  if (!response.ok || !response.arrayBuffer) {
    if (options?.throwOnError) {
      throw buildTtsError(response.status);
    }
    return null;
  }

  const base64 = bytesToBase64(new Uint8Array(response.arrayBuffer));

  await FileSystem.writeAsStringAsync(cacheUri, base64, {
    encoding: FileSystem.EncodingType.Base64
  });

  return cacheUri;
}
