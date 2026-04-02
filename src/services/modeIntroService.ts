import { MODE_IDS } from '../config/constants';
import { API_BASE_URL, CLAUDE_PROXY_URL } from '../config/env';
import { resolveModeIdCompat } from '../config/modeCompat';
import type { UserProfile } from '../models/UserProfile';

const MODE_INTRO_API_BACKOFF_MS = 5 * 60_000;
const MODE_INTRO_API_REQUEST_TIMEOUT_MS = 12_000;
const MODE_INTRO_API_MAX_ATTEMPTS = 2;
const MODE_INTRO_API_RETRY_DELAY_MS = 850;

let modeIntroApiBackoffUntilTs = 0;

interface FetchModeIntroFromApiParams {
  artistId: string;
  modeId: string;
  language: string;
  accessToken: string;
  preferredName?: string | null;
  memoryFacts?: string[];
}

interface ModeIntroEndpointResponse {
  greeting?: unknown;
}

function getPreferredName(profile: UserProfile | null | undefined): string | null {
  if (!profile?.preferredName || typeof profile.preferredName !== 'string') {
    return null;
  }

  const trimmed = profile.preferredName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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

function shouldSkipModeIntroApiCall(): boolean {
  if (isLocalWebHost()) {
    return true;
  }

  return Date.now() < modeIntroApiBackoffUntilTs;
}

function markModeIntroApiBackoff(): void {
  modeIntroApiBackoffUntilTs = Date.now() + MODE_INTRO_API_BACKOFF_MS;
}

function clearModeIntroApiBackoff(): void {
  modeIntroApiBackoffUntilTs = 0;
}

function buildModeIntroEndpointCandidates(): string[] {
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

function pickRandom<T>(values: T[]): T {
  if (values.length === 0) {
    throw new Error('pickRandom requires at least one value.');
  }
  const index = Math.floor(Math.random() * values.length);
  return values[index] ?? values[0]!;
}

function buildOnJaseFallback(preferredName: string | null): string {
  const opening = preferredName
    ? pickRandom([
        `Hey ${preferredName}, t'es en mode Dis-moi la verite.`,
        `Salut ${preferredName}, mode Dis-moi la verite active.`,
        `Bon ${preferredName}, Dis-moi la verite est parti.`
      ])
    : pickRandom([
        "Hey toi, t'es en mode Dis-moi la verite.",
        'Salut, mode Dis-moi la verite active.',
        'Bon, Dis-moi la verite est parti.'
      ]);

  const concept = pickRandom([
    "Ici j'suis cash: verite frontale, coaching concret, zero flafla.",
    "J'vais etre lucide et directe, sans humiliation gratuite.",
    "Tu veux du vrai? Je coupe les excuses et j'te donne l'angle utile."
  ]);

  const invitation = pickRandom([
    "Raconte-moi une situation precise et j'te guide tout de suite.",
    "Donne-moi ton vrai probleme pis on commence maintenant.",
    "Lance une affaire concrete de ta vie et on la decode ensemble."
  ]);

  return [opening, concept, invitation].join(' ');
}

function buildGrillFallback(preferredName: string | null): string {
  const opening = preferredName
    ? pickRandom([
        `Hey ${preferredName}, t'es en mode Mets-moi sur le grill.`,
        `Ok ${preferredName}, mode Mets-moi sur le grill active.`,
        `Salut ${preferredName}, Mets-moi sur le grill est en feu.`
      ])
    : pickRandom([
        "Hey toi, t'es en mode Mets-moi sur le grill.",
        'Ok, mode Mets-moi sur le grill active.',
        'Salut, Mets-moi sur le grill est en feu.'
      ]);

  const concept = pickRandom([
    "Ici c'est roast assume: plus mordant, plus direct, mais toujours intelligent.",
    "Tu demandes le feu: j'vais te roaster sans coussin, puis te recadrer pour vrai.",
    "On joue rough: verite dure, punchlines, et coaching brutal quand ca compte."
  ]);

  const invitation = pickRandom([
    "Donne-moi une habitude, un date rate, ou ton pire pattern, j'embarque.",
    "Pars avec une histoire concrete et j'te mets sur le grill pour vrai.",
    "Dis-moi ce que t'as fait cette semaine et j'te sors l'angle comique."
  ]);

  return [opening, concept, invitation].join(' ');
}

export function generateModeIntro(modeId: string, userProfile?: UserProfile | null): string {
  const canonicalModeId = resolveModeIdCompat(modeId);
  const preferredName = getPreferredName(userProfile);

  switch (canonicalModeId) {
    case MODE_IDS.ON_JASE:
      return buildOnJaseFallback(preferredName);
    case MODE_IDS.GRILL:
      return buildGrillFallback(preferredName);
    case MODE_IDS.ROAST_BATTLE:
      return preferredName
        ? `${preferredName}, bataille de roast commence. Tu lances, je replique, puis je donne le verdict final.`
        : 'Bataille de roast commence. Tu lances, je replique, puis je donne le verdict final.';
    case MODE_IDS.MEME_GENERATOR:
      return preferredName
        ? `${preferredName}, clique sur le petit + a gauche du champ texte pour ajouter ton image et donne moi un peu de contexte si tu peux, ca aide pour des memes plus droles!`
        : 'Clique sur le petit + a gauche du champ texte pour ajouter ton image et donne moi un peu de contexte si tu peux, ca aide pour des memes plus droles!';
    case MODE_IDS.SCREENSHOT_ANALYZER:
      return preferredName
        ? `${preferredName}, envoie ton screenshot ou colle le texto. Je juge l'histoire, puis je te donne une replique utile.`
        : "Envoie ton screenshot ou colle le texto. Je juge l'histoire, puis je te donne une replique utile.";
    case MODE_IDS.COACH_DE_VIE:
      return preferredName
        ? `${preferredName}, tu veux du vrai, pas du vernis? Dis-moi la situation et on la regle cash.`
        : 'Tu veux du vrai, pas du vernis? Dis-moi la situation et on la regle cash.';
    default:
      return preferredName
        ? `${preferredName}, on y va. Raconte-moi ce qui se passe et je te reponds direct.`
        : 'On y va. Raconte-moi ce qui se passe et je te reponds direct.';
  }
}

export async function fetchModeIntroFromApi(params: FetchModeIntroFromApiParams): Promise<string | null> {
  const token = params.accessToken.trim();
  if (!token || shouldSkipModeIntroApiCall()) {
    return null;
  }

  const canonicalModeId = resolveModeIdCompat(params.modeId);
  if (
    canonicalModeId !== MODE_IDS.ON_JASE &&
    canonicalModeId !== MODE_IDS.GRILL &&
    canonicalModeId !== MODE_IDS.MEME_GENERATOR
  ) {
    return null;
  }

  const endpointCandidates = buildModeIntroEndpointCandidates();
  if (endpointCandidates.length === 0) {
    return null;
  }

  const payload: Record<string, unknown> = {
    artistId: params.artistId,
    language: params.language,
    introType: 'mode_intro',
    modeId: canonicalModeId
  };

  if (typeof params.preferredName === 'string' && params.preferredName.trim()) {
    payload.preferredName = params.preferredName.trim();
  }
  if (Array.isArray(params.memoryFacts) && params.memoryFacts.length > 0) {
    payload.memoryFacts = params.memoryFacts
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 6);
  }

  let shouldBackoff = false;
  for (let attempt = 0; attempt < MODE_INTRO_API_MAX_ATTEMPTS; attempt += 1) {
    for (const endpoint of endpointCandidates) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), MODE_INTRO_API_REQUEST_TIMEOUT_MS);

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
          if (response.status >= 500) {
            shouldBackoff = true;
          }
          continue;
        }

        const data = (await response.json()) as ModeIntroEndpointResponse;
        const greeting = typeof data.greeting === 'string' ? data.greeting.trim() : '';
        if (greeting) {
          clearModeIntroApiBackoff();
          return greeting;
        }
      } catch {
        shouldBackoff = true;
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    if (attempt < MODE_INTRO_API_MAX_ATTEMPTS - 1) {
      await delay(MODE_INTRO_API_RETRY_DELAY_MS);
    }
  }

  if (shouldBackoff) {
    markModeIntroApiBackoff();
  }

  return null;
}
