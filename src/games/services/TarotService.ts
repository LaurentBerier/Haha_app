import { API_BASE_URL, CLAUDE_PROXY_URL } from '../../config/env';
import { useStore } from '../../store/useStore';
import type { TarotPoolCard, TarotReading, TarotTheme } from '../types';
import type { UserProfile } from '../../models/UserProfile';

export interface FetchTarotReadingParams {
  artistId: string;
  language: string;
  theme: TarotTheme | null;
  cards: TarotPoolCard[];
  userProfile?: UserProfile | null;
  memoryFacts?: string[];
}

export interface TarotReadingResult {
  readings: Omit<TarotReading, 'isFlipped'>[];
  grandFinale: string;
}

interface ApiError extends Error {
  code?: string;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function toBackendBaseUrl(): string {
  const explicitBase = API_BASE_URL.trim().replace(/\/+$/, '');
  if (explicitBase) {
    return explicitBase;
  }

  const proxyUrl = CLAUDE_PROXY_URL.trim();
  if (!proxyUrl) {
    return '';
  }

  if (proxyUrl.startsWith('/')) {
    return proxyUrl.replace(/\/claude\/?$/, '');
  }

  try {
    const parsed = new URL(proxyUrl);
    const normalizedPathname = parsed.pathname.replace(/\/+$/, '');
    const basePath = normalizedPathname.replace(/\/claude\/?$/, '');
    return `${parsed.protocol}//${parsed.host}${basePath}`;
  } catch {
    return '';
  }
}

function toError(payload: unknown, fallback: string): ApiError {
  const error = new Error(fallback) as ApiError;
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    payload.error &&
    typeof payload.error === 'object'
  ) {
    const source = payload.error as Record<string, unknown>;
    if (typeof source.message === 'string' && source.message.trim()) {
      error.message = source.message.trim();
    }
    if (typeof source.code === 'string' && source.code.trim()) {
      error.code = source.code.trim();
    }
  }
  return error;
}

function normalizeReadings(payload: unknown): TarotReadingResult {
  const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};

  if (!Array.isArray(source.readings)) {
    throw new Error('Tarot payload is invalid.');
  }

  const readings = (source.readings as unknown[])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const r = entry as Record<string, unknown>;
      return {
        cardName: typeof r.cardName === 'string' ? r.cardName.trim().slice(0, 60) : '',
        emoji: typeof r.emoji === 'string' ? r.emoji.trim().slice(0, 8) : '',
        interpretation:
          typeof r.interpretation === 'string' ? r.interpretation.trim().slice(0, 500) : ''
      };
    })
    .filter((r) => Boolean(r.cardName) && Boolean(r.interpretation))
    .slice(0, 3);

  if (readings.length !== 3) {
    throw new Error('Tarot payload must contain exactly 3 readings.');
  }

  const grandFinale =
    typeof source.grandFinale === 'string' && source.grandFinale.trim()
      ? source.grandFinale.trim().slice(0, 300)
      : 'Les cartes ont parlé.';

  return { readings, grandFinale };
}

export class TarotService {
  static async fetchReading(params: FetchTarotReadingParams): Promise<TarotReadingResult> {
    const baseUrl = toBackendBaseUrl();
    if (!baseUrl) {
      throw new Error('Missing backend API base URL.');
    }

    const accessToken = useStore.getState().session?.accessToken;
    if (!accessToken) {
      throw new Error('Unauthorized.');
    }

    const body: Record<string, unknown> = {
      artistId: params.artistId,
      language: params.language,
      cards: params.cards.map((c) => ({ name: c.name, emoji: c.emoji }))
    };

    if (params.theme) {
      body.theme = {
        id: params.theme.id,
        label: params.theme.label,
        emoji: params.theme.emoji
      };
    }

    if (params.userProfile) {
      const p = params.userProfile;
      const profilePayload: Record<string, unknown> = {};
      if (p.preferredName) profilePayload.preferredName = p.preferredName;
      if (p.age != null) profilePayload.age = p.age;
      if (p.sex) profilePayload.sex = p.sex;
      if (p.relationshipStatus) profilePayload.relationshipStatus = p.relationshipStatus;
      if (p.horoscopeSign) profilePayload.horoscopeSign = p.horoscopeSign;
      if (p.interests && p.interests.length > 0) profilePayload.interests = p.interests;
      if (Object.keys(profilePayload).length > 0) {
        body.userProfile = profilePayload;
      }
    }

    if (params.memoryFacts && params.memoryFacts.length > 0) {
      body.memoryFacts = params.memoryFacts;
    }

    let payload: unknown = null;
    let response: Response;

    try {
      response = await fetch(`${normalizeUrl(baseUrl)}/tarot-reading`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(body)
      });

      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw toError(payload, 'Tarot service unavailable.');
      }

      return normalizeReadings(payload);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Tarot service unavailable.');
    }
  }
}
