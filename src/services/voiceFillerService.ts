import { fetchAndCacheVoice } from './ttsService';

const CATHY_FILLERS_FR = ['Mmm...', 'Hm.', 'Ah oui?', 'OK pis?', 'Serieusement?', 'Continue.'];
const CATHY_FILLERS_EN = ['Mmm...', 'Hm.', 'Yeah?', 'Go on.', 'Seriously?', 'OK and?'];

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

  const fillers = resolveFillers(language);
  fillers.forEach((filler) => {
    void fetchAndCacheVoice(filler, normalizedArtistId, language, normalizedToken, { purpose: 'reply' });
  });
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
