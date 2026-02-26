import { MOCK_STREAM_TOKEN_DELAY_MS } from '../config/constants';
import type { FewShotExample } from '../models/Mode';

interface StreamParams {
  systemPrompt: string;
  userTurn: string;
  language: string;
  modeFewShots?: FewShotExample[];
  modeId?: string;
  onToken: (token: string) => void;
  onComplete: (usage: { tokensUsed: number }) => void;
  onError: (error: Error) => void;
}

const STOPWORDS = new Set([
  'a',
  'ai',
  'au',
  'aux',
  'avec',
  'ca',
  'ce',
  'ces',
  'dans',
  'de',
  'des',
  'du',
  'elle',
  'en',
  'est',
  'et',
  'il',
  'je',
  'j',
  'la',
  'le',
  'les',
  'mais',
  'me',
  'mes',
  'mon',
  'ne',
  'nous',
  'on',
  'ou',
  'par',
  'pas',
  'pour',
  'que',
  'qui',
  'se',
  'ses',
  'sur',
  'ta',
  'te',
  'tes',
  'toi',
  'ton',
  'tu',
  'un',
  'une',
  'vos',
  'vous',
  'your',
  'the',
  'is',
  'are',
  'to'
]);

const ZODIAC_SIGNS = [
  'belier',
  'taureau',
  'gemeaux',
  'cancer',
  'lion',
  'vierge',
  'balance',
  'scorpion',
  'sagittaire',
  'capricorne',
  'verseau',
  'poissons'
] as const;

const DISPLAY_SIGN: Record<(typeof ZODIAC_SIGNS)[number], string> = {
  belier: 'Bélier',
  taureau: 'Taureau',
  gemeaux: 'Gémeaux',
  cancer: 'Cancer',
  lion: 'Lion',
  vierge: 'Vierge',
  balance: 'Balance',
  scorpion: 'Scorpion',
  sagittaire: 'Sagittaire',
  capricorne: 'Capricorne',
  verseau: 'Verseau',
  poissons: 'Poissons'
};

const IGNORED_NAME_WORDS = new Set([
  'Message',
  'Fais',
  'Bonjour',
  'Salut',
  'Horoscope',
  'Meteo',
  'Météo',
  'Demain',
  'Aujourd',
  'Cathy'
]);

type StructuredSignal = {
  name: string | null;
  age: number | null;
  sign: string | null;
  city: string | null;
  day: string | null;
  weather: string | null;
  theme: string | null;
  occasion: string | null;
};

type RecentEntry = {
  response: string;
  modeId: string;
};

const recentResponses: RecentEntry[] = [];
const RECENCY_LIMIT = 6;

const DEFAULT_CATHY_FALLBACK = "Heille, j'ai-tu l'air d'une machine a reponses? Reformule.";
const CATHY_FALLBACKS = [
  DEFAULT_CATHY_FALLBACK,
  "Ca, c'est le genre de question qui meriterait que je te charge double.",
  "Mon dieu, t'es intense. J'aime ca. Continue.",
  "J'ai pas compris, pis je m'en vante meme pas.",
  "OK, mais genre... es-tu serieux?",
  "Tu penses que je suis ton Alexa? Pose-moi une vraie question.",
  "La tu me niaises, right?",
  "Scuse, j'etais en train de juger quelqu'un d'autre. Recommence.",
  "Je te donne 2/10 pour l'effort, mais 8/10 pour le culot.",
  "Ouin... y'a tu quelqu'un d'autre qui peut repondre a ca?"
];

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[’']/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function overlapScore(sourceTokens: string[], candidateTokens: string[]): number {
  if (!sourceTokens.length || !candidateTokens.length) {
    return 0;
  }

  const source = new Set(sourceTokens);
  const candidate = new Set(candidateTokens);
  let overlapCount = 0;
  source.forEach((token) => {
    if (candidate.has(token)) {
      overlapCount += 1;
    }
  });

  const union = source.size + candidate.size - overlapCount;
  return union === 0 ? 0 : overlapCount / union;
}

function getEffectiveRecencyLimit(poolSize: number): number {
  if (poolSize <= 1) {
    return 1;
  }
  return Math.min(RECENCY_LIMIT, Math.max(1, Math.floor(poolSize * 0.6)));
}

function excludeRecent(examples: FewShotExample[], modeId: string): FewShotExample[] {
  if (!examples.length) {
    return examples;
  }

  const effectiveLimit = getEffectiveRecencyLimit(examples.length);
  const recentForMode = recentResponses
    .filter((entry) => entry.modeId === modeId)
    .slice(-effectiveLimit)
    .map((entry) => entry.response);

  const available = examples.filter((example) => !recentForMode.includes(example.response));
  if (available.length > 0) {
    return available;
  }

  const lastUsed = recentForMode[recentForMode.length - 1];
  const safePool = examples.filter((example) => example.response !== lastUsed);
  return safePool.length > 0 ? safePool : examples;
}

function markUsed(response: string, modeId: string): void {
  recentResponses.push({ response, modeId });
  if (recentResponses.length > RECENCY_LIMIT) {
    recentResponses.shift();
  }
}

function pickMatchingExample(userTurn: string, modeFewShots: FewShotExample[]): FewShotExample | null {
  if (!modeFewShots.length) {
    return null;
  }

  const normalizedTurn = normalize(userTurn);
  const turnTokens = tokenize(userTurn);

  const ranked = modeFewShots
    .map((example) => {
      const normalizedInput = normalize(example.input);
      const tokenScore = overlapScore(turnTokens, tokenize(example.input));
      const containsBoost =
        normalizedInput.includes(normalizedTurn) || normalizedTurn.includes(normalizedInput) ? 0.35 : 0;

      return {
        example,
        score: tokenScore + containsBoost
      };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, 3);
  const best = top[0];
  if (!best) {
    return null;
  }

  if (best.score <= 0) {
    return modeFewShots[Math.floor(Math.random() * modeFewShots.length)] ?? null;
  }

  const competitive = top.filter((entry) => best.score - entry.score <= 0.25);
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[PickMatch] scores:', top.map((entry) => entry.score.toFixed(3)));
    console.log('[PickMatch] competitive pool size:', competitive.length);
  }
  const pool = competitive.length ? competitive : [best];
  const picked = pool[Math.floor(Math.random() * pool.length)];

  return picked?.example ?? null;
}

function parseVariables(raw?: string): Record<string, string> {
  if (!raw) {
    return {};
  }

  return raw
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const [key, ...rest] = entry.split('=');
      if (!key || !rest.length) {
        return acc;
      }
      acc[key.trim().toLowerCase()] = rest.join('=').trim();
      return acc;
    }, {});
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCapitalizedWord(userTurn: string): string | null {
  const directedMatch = userTurn.match(
    /(?:^|\s)(?:pour|de|a|à)\s+([A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜ][A-Za-zÀÂÄÇÉÈÊËÎÏÔÖÙÛÜàâäçéèêëîïôöùûü'-]*)/gu
  );
  if (directedMatch?.length) {
    const extracted = directedMatch
      .map((entry) => entry.replace(/\b(?:pour|de|a|à)\s+/iu, '').trim())
      .find((name) => !IGNORED_NAME_WORDS.has(name));
    if (extracted) {
      return extracted;
    }
  }

  const matches = userTurn.match(/\b[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜ][A-Za-zÀÂÄÇÉÈÊËÎÏÔÖÙÛÜàâäçéèêëîïôöùûü'-]*\b/gu) ?? [];
  return matches.find((word) => !IGNORED_NAME_WORDS.has(word)) ?? null;
}

function extractAge(userTurn: string): number | null {
  const match = userTurn.match(/\b(\d{1,3})\s*ans?\b/u) ?? userTurn.match(/\b(\d{1,3})\b/u);
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractSign(userTurn: string): string | null {
  const normalizedTurn = normalize(userTurn);
  const found = ZODIAC_SIGNS.find((item) => normalizedTurn.includes(item));
  if (!found) {
    return null;
  }
  return DISPLAY_SIGN[found];
}

function extractCity(userTurn: string): string | null {
  const match = userTurn.match(
    /(?:^|\s)(?:a|à|de|pour)\s+([A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜ][A-Za-zÀÂÄÇÉÈÊËÎÏÔÖÙÛÜàâäçéèêëîïôöùûü'-]*)/u
  );
  return match?.[1] ?? null;
}

function extractDay(userTurn: string): string | null {
  const normalizedTurn = normalize(userTurn);
  if (normalizedTurn.includes('demain')) {
    return 'demain';
  }
  if (normalizedTurn.includes('aujourd hui')) {
    return "aujourd'hui";
  }
  if (normalizedTurn.includes('semaine')) {
    return 'semaine';
  }
  return null;
}

function extractWeather(userTurn: string): string | null {
  const normalizedTurn = normalize(userTurn);
  if (normalizedTurn.includes('canicule')) {
    return 'canicule';
  }
  if (normalizedTurn.includes('pluie')) {
    return 'pluie';
  }
  if (normalizedTurn.includes('neige')) {
    return 'neige';
  }
  if (normalizedTurn.includes('soleil') || normalizedTurn.includes('ensoleille')) {
    return 'soleil';
  }
  if (normalizedTurn.includes('orage')) {
    return 'orage';
  }
  if (normalizedTurn.includes('nuage')) {
    return 'nuage';
  }
  return null;
}

function extractTheme(userTurn: string): string | null {
  const normalizedTurn = normalize(userTurn);
  if (normalizedTurn.includes('amour')) {
    return 'amour';
  }
  if (normalizedTurn.includes('travail') || normalizedTurn.includes('job')) {
    return 'travail';
  }
  if (normalizedTurn.includes('sante')) {
    return 'sante';
  }
  return null;
}

function extractOccasion(userTurn: string): string | null {
  const normalizedTurn = normalize(userTurn);
  if (normalizedTurn.includes('retraite')) {
    return 'retraite';
  }
  if (normalizedTurn.includes('fete') || normalizedTurn.includes('anniversaire')) {
    return 'fete';
  }
  if (normalizedTurn.includes('promotion')) {
    return 'promotion';
  }
  if (normalizedTurn.includes('rupture')) {
    return 'rupture';
  }
  return null;
}

function extractSignals(userTurn: string): StructuredSignal {
  return {
    name: extractCapitalizedWord(userTurn),
    age: extractAge(userTurn),
    sign: extractSign(userTurn),
    city: extractCity(userTurn),
    day: extractDay(userTurn),
    weather: extractWeather(userTurn),
    theme: extractTheme(userTurn),
    occasion: extractOccasion(userTurn)
  };
}

function inferVariableValue(key: string, userTurn: string): string | null {
  const normalizedKey = normalize(key);
  const signals = extractSignals(userTurn);

  if (normalizedKey === 'age') {
    return signals.age ? String(signals.age) : null;
  }

  if (normalizedKey === 'prenom') {
    return signals.name;
  }

  if (normalizedKey === 'signe') {
    return signals.sign;
  }

  if (normalizedKey === 'ville') {
    return signals.city;
  }

  if (normalizedKey === 'jour') {
    return signals.day;
  }

  if (normalizedKey === 'theme') {
    return signals.theme;
  }

  if (normalizedKey === 'occasion') {
    return signals.occasion;
  }

  return null;
}

function scoreStructuredExample(
  example: FewShotExample,
  userTurn: string,
  desired: Record<string, { value: string | number | null | undefined; weight: number }>
): number {
  const vars = parseVariables(example.variables);
  const turnTokens = tokenize(userTurn);
  const inputTokens = tokenize(example.input);
  const base = overlapScore(turnTokens, inputTokens);
  let score = base * 0.3;

  Object.entries(desired).forEach(([rawKey, descriptor]) => {
    const { value: rawValue, weight } = descriptor;
    const key = rawKey.toLowerCase();
    const value = rawValue ? normalize(String(rawValue)) : '';
    if (!value) {
      return;
    }

    const exampleValue = vars[key];
    if (!exampleValue) {
      score -= 0.05 * weight;
      return;
    }

    const normalizedExampleValue = normalize(exampleValue);
    if (normalizedExampleValue === value) {
      score += 1.2 * weight;
      return;
    }

    if (normalizedExampleValue.includes(value) || value.includes(normalizedExampleValue)) {
      score += 0.8 * weight;
      return;
    }

    const valueOverlap = overlapScore(tokenize(value), tokenize(normalizedExampleValue));
    score += 0.6 * weight * valueOverlap;

    if (key === 'age') {
      const desiredAge = Number.parseInt(value, 10);
      const sampleAge = Number.parseInt(normalizedExampleValue, 10);
      if (Number.isFinite(desiredAge) && Number.isFinite(sampleAge)) {
        const delta = Math.abs(desiredAge - sampleAge);
        score += Math.max(0, 0.8 - delta / 40) * weight;
      }
    }
  });

  return score;
}

function pickStructuredExample(
  userTurn: string,
  modeFewShots: FewShotExample[],
  desired: Record<string, { value: string | number | null | undefined; weight: number }>
): FewShotExample | null {
  if (!modeFewShots.length) {
    return null;
  }

  const ranked = modeFewShots
    .map((example) => ({
      example,
      score: scoreStructuredExample(example, userTurn, desired)
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) {
    return null;
  }

  if (best.score <= 0) {
    return pickMatchingExample(userTurn, modeFewShots);
  }

  const top = ranked.slice(0, 2);
  const pool = top.filter((entry) => best.score - entry.score <= 0.2);
  const picked = (pool.length ? pool : [best])[Math.floor(Math.random() * (pool.length ? pool : [best]).length)];
  return picked?.example ?? best.example;
}

function pickModeSpecificExample(userTurn: string, modeFewShots: FewShotExample[], modeId?: string): FewShotExample | null {
  if (!modeFewShots.length) {
    return null;
  }

  const signals = extractSignals(userTurn);

  if (modeId === 'horoscope') {
    return pickStructuredExample(userTurn, modeFewShots, {
      signe: { value: signals.sign, weight: 2.4 },
      theme: { value: signals.theme, weight: 0.7 }
    });
  }

  if (modeId === 'meteo') {
    return pickStructuredExample(userTurn, modeFewShots, {
      ville: { value: signals.city, weight: 2.2 },
      jour: { value: signals.day, weight: 0.7 },
      meteo: { value: signals.weather, weight: 1.8 }
    });
  }

  if (modeId === 'message-personnalise') {
    return pickStructuredExample(userTurn, modeFewShots, {
      occasion: { value: signals.occasion, weight: 2 },
      age: { value: signals.age, weight: 1.2 },
      prenom: { value: signals.name, weight: 1.8 }
    });
  }

  return pickMatchingExample(userTurn, modeFewShots);
}

function applyVariableSubstitutions(
  response: string,
  variableMap: Record<string, string>,
  userTurn: string
): string {
  let next = response;

  Object.entries(variableMap).forEach(([key, sampleValue]) => {
    const inferred = inferVariableValue(key, userTurn);
    if (!sampleValue || !inferred || normalize(sampleValue) === normalize(inferred)) {
      return;
    }

    const matcher = new RegExp(escapeRegex(sampleValue), 'giu');
    next = next.replace(matcher, inferred);
  });

  return next;
}

function buildFallbackReply(modeId?: string): string {
  const fallbackModeId = `fallback:${modeId ?? 'default'}`;
  const fallbackExamples: FewShotExample[] = CATHY_FALLBACKS.map((response) => ({
    input: 'fallback',
    response
  }));
  const pool = excludeRecent(fallbackExamples, fallbackModeId);
  const picked = pool[Math.floor(Math.random() * pool.length)] ?? fallbackExamples[0];
  const output = picked?.response ?? DEFAULT_CATHY_FALLBACK;
  markUsed(output, fallbackModeId);
  return output;
}

function buildMockReply(userTurn: string, modeFewShots: FewShotExample[] = [], modeId?: string): string {
  const modeKey = modeId ?? 'default';
  const filtered = excludeRecent(modeFewShots, modeKey);
  const matched = pickModeSpecificExample(userTurn, filtered, modeId);
  if (!matched) {
    return buildFallbackReply(modeId);
  }

  const variableMap = parseVariables(matched.variables);
  const output = applyVariableSubstitutions(matched.response, variableMap, userTurn);
  markUsed(output, modeKey);
  return output;
}

export function streamMockReply(params: StreamParams): () => void {
  const { userTurn, modeFewShots = [], modeId, onToken, onComplete, onError } = params;

  try {
    const output = buildMockReply(userTurn, modeFewShots, modeId);
    const tokens = output.split(' ');
    let index = 0;

    const timer = setInterval(() => {
      if (index >= tokens.length) {
        clearInterval(timer);
        onComplete({ tokensUsed: tokens.length });
        return;
      }

      onToken(`${tokens[index]} `);
      index += 1;
    }, MOCK_STREAM_TOKEN_DELAY_MS);

    return () => clearInterval(timer);
  } catch (error) {
    const normalized =
      error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : 'Unknown streaming error');
    onError(normalized);
    return () => undefined;
  }
}
