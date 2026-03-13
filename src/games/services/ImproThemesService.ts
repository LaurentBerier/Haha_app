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

function hasSelfReference(value: string, language: string): boolean {
  const text = normalizeText(value).toLowerCase();
  if (!text) {
    return false;
  }

  if (language.toLowerCase().startsWith('en')) {
    return /\b(i|me|my|mine|myself|i'm|i'll|i'd)\b/.test(text);
  }

  return /\b(je|moi|mon|ma|mes|mienne|mien|moi-meme)\b/.test(text) || /(^|\W)j'/.test(text);
}

function toExternalPremise(premisse: string, language: string): string {
  const source = normalizeText(premisse);
  if (!source) {
    return language.toLowerCase().startsWith('en')
      ? 'You are pulled into a ridiculous situation and everyone expects you to handle it.'
      : 'Tu te retrouves dans une situation absurde pis tout le monde pense que tu vas gerer ca.';
  }

  if (language.toLowerCase().startsWith('en')) {
    return source
      .replace(/\bi'm\b/gi, "you're")
      .replace(/\bi'll\b/gi, "you'll")
      .replace(/\bi'd\b/gi, "you'd")
      .replace(/\bmyself\b/gi, 'yourself')
      .replace(/\bmine\b/gi, 'yours')
      .replace(/\bmy\b/gi, 'your')
      .replace(/\bme\b/gi, 'you')
      .replace(/\bi\b/gi, 'you');
  }

  return source
    .replace(/(^|\W)j'/gi, '$1tu ')
    .replace(/\bje\b/gi, 'tu')
    .replace(/\bmoi\b/gi, 'toi')
    .replace(/\bmon\b/gi, 'ton')
    .replace(/\bma\b/gi, 'ta')
    .replace(/\bmes\b/gi, 'tes');
}

function toSelfPremise(premisse: string, language: string): string {
  const source = normalizeText(premisse);
  if (language.toLowerCase().startsWith('en')) {
    return source ? `I jump in: ${source}` : 'I jump in with you, and we escalate a small mess into full comedy chaos.';
  }
  return source
    ? `Je debarque la-dedans: ${source}`
    : 'Je debarque avec toi, pis on transforme un petit probleme en gros chaos hilarant.';
}

function enforceSingleSelfTheme(themes: ImproTheme[], language: string): ImproTheme[] {
  if (themes.length === 0) {
    return themes;
  }

  const next = themes.map((theme) => ({ ...theme }));
  const selfIndexes = next
    .map((theme, index) => (hasSelfReference(`${theme.titre} ${theme.premisse}`, language) ? index : -1))
    .filter((index) => index >= 0);

  if (selfIndexes.length === 0) {
    const firstTheme = next[0];
    if (firstTheme) {
      next[0] = {
        id: firstTheme.id,
        type: firstTheme.type,
        titre: firstTheme.titre,
        premisse: toSelfPremise(firstTheme.premisse, language)
      };
    }
    return next;
  }

  const keepIndex = selfIndexes[0] ?? 0;
  for (const index of selfIndexes) {
    if (index === keepIndex) {
      continue;
    }
    const current = next[index];
    if (!current) {
      continue;
    }
    next[index] = {
      id: current.id,
      type: current.type,
      titre: current.titre,
      premisse: toExternalPremise(current.premisse, language)
    };
  }

  const remainingSelf = next
    .map((theme, index) => (hasSelfReference(`${theme.titre} ${theme.premisse}`, language) ? index : -1))
    .filter((index) => index >= 0);

  if (remainingSelf.length > 1) {
    for (let i = 1; i < remainingSelf.length; i += 1) {
      const idx = remainingSelf[i];
      if (idx === undefined) {
        continue;
      }
      const current = next[idx];
      if (!current) {
        continue;
      }
      next[idx] = {
        id: current.id,
        type: current.type,
        titre: current.titre,
        premisse: toExternalPremise(current.premisse, language)
      };
    }
  }

  return next;
}

function normalizeThemes(raw: unknown, language: string): ImproTheme[] {
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

  return enforceSingleSelfTheme(normalized, language);
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

    return normalizeThemes(payload, params.language);
  }
}
