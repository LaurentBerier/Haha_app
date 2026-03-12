import { API_BASE_URL, CLAUDE_PROXY_URL } from '../../config/env';
import type { UserProfile } from '../../models/UserProfile';
import { useStore } from '../../store/useStore';

export interface ImproTheme {
  id: number;
  type: string;
  titre: string;
  premisse: string;
}

interface FetchThemesParams {
  language: string;
  userProfile: UserProfile | null;
  nonce?: number;
  avoidThemes?: string[];
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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeThemes(raw: unknown): ImproTheme[] {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const themesRaw = Array.isArray(source.themes) ? source.themes : [];

  const normalized = themesRaw
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => {
      const theme = entry as Record<string, unknown>;
      const idFromPayload = Number.parseInt(String(theme.id ?? ''), 10);
      const type = normalizeText(theme.type).slice(0, 32) || 'universel';
      const titre = normalizeText(theme.titre);
      const premisse = normalizeText(theme.premisse);

      return {
        id: Number.isFinite(idFromPayload) && idFromPayload > 0 ? idFromPayload : index + 1,
        type,
        titre,
        premisse
      };
    })
    .filter((entry) => Boolean(entry.titre) && Boolean(entry.premisse));

  if (normalized.length !== 3) {
    throw new Error('Theme payload must include exactly 3 themes.');
  }

  return normalized;
}

function normalizeUserProfileForApi(userProfile: UserProfile | null): Record<string, unknown> {
  return {
    preferredName: typeof userProfile?.preferredName === 'string' ? userProfile.preferredName : null,
    age: typeof userProfile?.age === 'number' ? userProfile.age : null,
    horoscopeSign: typeof userProfile?.horoscopeSign === 'string' ? userProfile.horoscopeSign : null,
    interests: Array.isArray(userProfile?.interests) ? userProfile.interests : [],
    relationshipStatus: typeof userProfile?.relationshipStatus === 'string' ? userProfile.relationshipStatus : null,
    city: null,
    job: null
  };
}

export class ImproThemesService {
  static async fetchThemes(params: FetchThemesParams): Promise<ImproTheme[]> {
    const baseUrl = toBackendBaseUrl();
    if (!baseUrl) {
      throw new Error('Missing backend API base URL.');
    }

    const accessToken = useStore.getState().session?.accessToken;
    if (!accessToken) {
      throw new Error('Unauthorized.');
    }

    const response = await fetch(`${normalizeUrl(baseUrl)}/impro-themes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        language: params.language,
        userProfile: normalizeUserProfileForApi(params.userProfile),
        nonce: Number.isFinite(params.nonce) ? params.nonce : Date.now(),
        avoidThemes: Array.isArray(params.avoidThemes) ? params.avoidThemes : []
      })
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw toError(payload, 'Impro themes service unavailable.');
    }

    return normalizeThemes(payload);
  }
}
