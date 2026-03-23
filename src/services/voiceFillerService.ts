import { fetchAndCacheVoice } from './ttsService';

const CATHY_FILLERS_FR = ['Mmm...', 'Hm.', 'Ah oui?', 'OK pis?', 'Serieusement?', 'Continue.'];
const CATHY_FILLERS_EN = ['Mmm...', 'Hm.', 'Yeah?', 'Go on.', 'Seriously?', 'OK and?'];
const PREWARMED_FILLER_KEYS = new Set<string>();

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

  const filler = pickRandomEntry(resolveFillers(language));
  if (!filler) {
    return;
  }

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

  const filler = pickRandomEntry(resolveFillers(language));
  if (!filler) {
    return null;
  }

  return fetchAndCacheVoice(filler, normalizedArtistId, language, normalizedToken, { purpose: 'reply' });
}
