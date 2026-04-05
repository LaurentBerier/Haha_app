import { fetchAndCacheVoice } from './ttsService';

const CATHY_FILLERS_FR = ['Mmm...', 'Hmm...', 'Mm-hm...', 'Hmmm...', 'Uh-huh...'];
const CATHY_FILLERS_EN = ['Mmm...', 'Hmm...', 'Mm-hm...', 'Hmmm...', 'Uh-huh...'];
const PREWARMED_FILLER_KEYS = new Set<string>();
const PREWARMED_FILLER_BY_SCOPE = new Map<string, string>();
const LAST_FILLER_AT_BY_SCOPE = new Map<string, number>();
const parsedFillerCooldownMs = Number.parseInt(process.env.EXPO_PUBLIC_VOICE_FILLER_COOLDOWN_MS ?? '', 10);
const FILLER_COOLDOWN_MS =
  Number.isFinite(parsedFillerCooldownMs) && parsedFillerCooldownMs >= 400 ? parsedFillerCooldownMs : 2_500;

function resolveFillers(language: string): string[] {
  return language.toLowerCase().startsWith('en') ? CATHY_FILLERS_EN : CATHY_FILLERS_FR;
}

function pickRandomEntry(values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * values.length);
  return values[index] ?? values[0] ?? null;
}

export function prewarmVoiceFillers(artistId: string, language: string, accessToken: string): void {
  const normalizedArtistId = artistId.trim();
  const normalizedToken = accessToken.trim();
  if (!normalizedArtistId || !normalizedToken) {
    return;
  }

  const normalizedLanguage = language.toLowerCase().startsWith('en') ? 'en' : 'fr';
  const prewarmKey = `${normalizedArtistId}|${normalizedLanguage}`;
  if (PREWARMED_FILLER_KEYS.has(prewarmKey)) {
    return;
  }
  PREWARMED_FILLER_KEYS.add(prewarmKey);

  const fillers = resolveFillers(language);
  if (fillers.length === 0) {
    return;
  }

  // Warm a single filler to reduce startup quota consumption and avoid burst traffic.
  const filler = pickRandomEntry(fillers);
  if (!filler) {
    return;
  }

  PREWARMED_FILLER_BY_SCOPE.set(prewarmKey, filler);
  void fetchAndCacheVoice(filler, normalizedArtistId, language, normalizedToken, { purpose: 'reply' });
}

export async function getRandomFillerUri(
  artistId: string,
  language: string,
  accessToken: string
): Promise<string | null> {
  const normalizedArtistId = artistId.trim();
  const normalizedToken = accessToken.trim();
  if (!normalizedArtistId || !normalizedToken) {
    return null;
  }

  const normalizedLanguage = language.toLowerCase().startsWith('en') ? 'en' : 'fr';
  const scopeKey = `${normalizedArtistId}|${normalizedLanguage}`;
  const now = Date.now();
  const lastStartedAt = LAST_FILLER_AT_BY_SCOPE.get(scopeKey) ?? 0;
  if (now - lastStartedAt < FILLER_COOLDOWN_MS) {
    return null;
  }

  const prewarmedFiller = PREWARMED_FILLER_BY_SCOPE.get(scopeKey) ?? null;
  if (prewarmedFiller) {
    PREWARMED_FILLER_BY_SCOPE.delete(scopeKey);
  }

  const filler = prewarmedFiller ?? pickRandomEntry(resolveFillers(language));
  if (!filler) {
    return null;
  }

  LAST_FILLER_AT_BY_SCOPE.set(scopeKey, now);
  return fetchAndCacheVoice(filler, normalizedArtistId, language, normalizedToken, { purpose: 'reply' });
}

export function __resetVoiceFillerServiceForTests(): void {
  PREWARMED_FILLER_KEYS.clear();
  PREWARMED_FILLER_BY_SCOPE.clear();
  LAST_FILLER_AT_BY_SCOPE.clear();
}
