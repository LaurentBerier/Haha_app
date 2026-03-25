const DEFAULT_LANGUAGE_BY_PREFIX: Record<string, string> = {
  ar: 'ar-SA',
  de: 'de-DE',
  en: 'en-CA',
  es: 'es-ES',
  fr: 'fr-CA',
  it: 'it-IT',
  ja: 'ja-JP',
  ko: 'ko-KR',
  nl: 'nl-NL',
  pt: 'pt-BR',
  ru: 'ru-RU',
  tr: 'tr-TR',
  zh: 'zh-CN'
};

const LANGUAGE_ALIAS_TO_TAG: Record<string, string> = {
  anglais: 'en-CA',
  english: 'en-CA',
  francais: 'fr-CA',
  french: 'fr-CA',
  quebecois: 'fr-CA',
  quebecoise: 'fr-CA',
  espagnol: 'es-ES',
  espanol: 'es-ES',
  spanish: 'es-ES',
  castellano: 'es-ES',
  portugais: 'pt-BR',
  portuguese: 'pt-BR',
  portugues: 'pt-BR',
  allemand: 'de-DE',
  german: 'de-DE',
  deutsch: 'de-DE',
  italien: 'it-IT',
  italian: 'it-IT',
  arabe: 'ar-SA',
  arabic: 'ar-SA',
  chinois: 'zh-CN',
  chinese: 'zh-CN',
  mandarin: 'zh-CN',
  japonais: 'ja-JP',
  japanese: 'ja-JP',
  coreen: 'ko-KR',
  korean: 'ko-KR',
  russe: 'ru-RU',
  russian: 'ru-RU',
  hindi: 'hi-IN',
  polonais: 'pl-PL',
  polish: 'pl-PL',
  neerlandais: 'nl-NL',
  dutch: 'nl-NL',
  turc: 'tr-TR',
  turkish: 'tr-TR'
};

const LANGUAGE_ALIAS_KEYS = Object.keys(LANGUAGE_ALIAS_TO_TAG).sort((left, right) => right.length - left.length);

const EXPLICIT_SWITCH_PATTERNS = [
  /\b(?:parle|reponds?|repondre|ecris|continue|change|switch)\b/i,
  /\b(?:speak|talk|reply|respond|answer|continue|switch|change)\b/i
];

const EXPLICIT_LANGUAGE_WORD_PATTERN = /\b(?:langue|language|idiome)\b/i;

const EXPLICIT_TARGET_PATTERN =
  /\b(?:parle|reponds?|repondre|ecris|continue|change|switch|speak|talk|reply|respond|answer)\b[^.!?\n]{0,72}\b(?:en|in|to)\s+([a-z0-9-]{2,24}(?:\s+[a-z0-9-]{2,24}){0,2})/i;

const ENGLISH_HINT_WORDS = new Set([
  'about',
  'and',
  'because',
  'can',
  'could',
  'hello',
  'help',
  'hi',
  'how',
  'i',
  'just',
  'make',
  'need',
  'please',
  'tell',
  'thanks',
  'thank',
  'the',
  'this',
  'today',
  'tomorrow',
  'want',
  'what',
  'when',
  'where',
  'why',
  'with',
  'would',
  'you',
  'your'
]);

const FRENCH_HINT_WORDS = new Set([
  'avec',
  'bonjour',
  'comment',
  'demain',
  'encore',
  'est',
  'etre',
  'hier',
  'je',
  'merci',
  'nous',
  'pas',
  'peux',
  'pour',
  'pourquoi',
  'quoi',
  'salut',
  'suis',
  'tu',
  'une',
  'veux',
  'vous'
]);

const SPANISH_HINT_WORDS = new Set([
  'hola',
  'gracias',
  'por',
  'para',
  'quiero',
  'puedes',
  'como',
  'que',
  'cuando',
  'donde',
  'noticias',
  'clima'
]);

const PORTUGUESE_HINT_WORDS = new Set([
  'ola',
  'obrigado',
  'obrigada',
  'quero',
  'voce',
  'voces',
  'como',
  'quando',
  'onde',
  'noticias',
  'tempo',
  'para'
]);

const GERMAN_HINT_WORDS = new Set([
  'hallo',
  'danke',
  'bitte',
  'ich',
  'du',
  'sie',
  'wie',
  'was',
  'wann',
  'wo',
  'nachrichten',
  'wetter'
]);

const ITALIAN_HINT_WORDS = new Set([
  'ciao',
  'grazie',
  'per',
  'voglio',
  'puoi',
  'come',
  'quando',
  'dove',
  'notizie',
  'meteo'
]);

const LATIN_LANGUAGE_SCORES = [
  {
    code: 'en-CA',
    words: ENGLISH_HINT_WORDS,
    patterns: [/\bi am\b/i, /\bi want\b/i, /\bcan you\b/i, /\bplease\b/i],
    diacriticPattern: null as RegExp | null
  },
  {
    code: 'fr-CA',
    words: FRENCH_HINT_WORDS,
    patterns: [/\bje (?:suis|veux|peux)\b/i, /\btu (?:es|veux|peux)\b/i, /\bs['’]il\b/i],
    diacriticPattern: /[àâäæçéèêëîïôöœùûüÿ]/i
  },
  {
    code: 'es-ES',
    words: SPANISH_HINT_WORDS,
    patterns: [/\bpuedes\b/i, /\bquiero\b/i, /[¿¡]/],
    diacriticPattern: /[ñáéíóúü]/i
  },
  {
    code: 'pt-BR',
    words: PORTUGUESE_HINT_WORDS,
    patterns: [/\bvoce\b/i, /\bobrigad[oa]\b/i],
    diacriticPattern: /[ãõâêôáéíóúç]/i
  },
  {
    code: 'de-DE',
    words: GERMAN_HINT_WORDS,
    patterns: [/\bich\b/i, /\bdanke\b/i],
    diacriticPattern: /[äöüß]/i
  },
  {
    code: 'it-IT',
    words: ITALIAN_HINT_WORDS,
    patterns: [/\bvoglio\b/i, /\bpuoi\b/i],
    diacriticPattern: /[àèéìíîòóù]/i
  }
];

export interface ExplicitLanguageSwitchResult {
  detected: boolean;
  language: string | null;
}

export interface LanguageResolutionResult {
  language: string;
  source: 'explicit' | 'auto' | 'current';
  explicitDetected: boolean;
  explicitRecognized: boolean;
}

function normalizeForMatching(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeLatin(text: string): string[] {
  return normalizeForMatching(text)
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function getLanguagePrefix(language: string): string {
  const normalized = typeof language === 'string' ? language.trim().toLowerCase() : '';
  if (!normalized) {
    return 'fr';
  }
  const [prefix] = normalized.split(/[-_]/);
  return prefix || 'fr';
}

function findAliasLanguage(normalizedText: string): string | null {
  for (const alias of LANGUAGE_ALIAS_KEYS) {
    const pattern = new RegExp(`\\b${alias}\\b`, 'i');
    if (!pattern.test(normalizedText)) {
      continue;
    }
    return LANGUAGE_ALIAS_TO_TAG[alias] ?? null;
  }
  return null;
}

function isLanguageTag(value: string): boolean {
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i.test(value.trim());
}

function extractCodeCandidate(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (isLanguageTag(trimmed)) {
    return trimmed;
  }

  const fromDirective =
    trimmed.match(/\b(?:code|langue|language)\s*[:=]?\s*([a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2})\b/i)?.[1] ?? null;
  if (fromDirective) {
    return fromDirective;
  }

  const fromPreposition = trimmed.match(/\b(?:en|in|to)\s+([a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2})\b/i)?.[1] ?? null;
  return fromPreposition;
}

function extractExplicitTarget(normalizedText: string): string | null {
  const match = normalizedText.match(EXPLICIT_TARGET_PATTERN);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function normalizeLanguageTagParts(language: string): string {
  const normalized = language.trim().replace(/_/g, '-');
  const parts = normalized.split('-').filter(Boolean);
  if (parts.length === 0) {
    return '';
  }

  const head = parts[0];
  if (!head) {
    return '';
  }
  const rest = parts.slice(1);
  const lang = head.toLowerCase();
  const normalizedRest = rest.map((part, index) => {
    if (part.length === 4 && /^[a-z]+$/i.test(part)) {
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }
    if ((part.length === 2 && /^[a-z]+$/i.test(part)) || (part.length === 3 && /^[0-9]+$/.test(part))) {
      return part.toUpperCase();
    }
    return index === rest.length - 1 ? part.toUpperCase() : part;
  });

  return [lang, ...normalizedRest].join('-');
}

export function normalizeConversationLanguage(language: string, fallback = 'fr-CA'): string {
  if (typeof language !== 'string') {
    return fallback;
  }

  const trimmed = language.trim();
  if (!trimmed) {
    return fallback;
  }

  if (!isLanguageTag(trimmed)) {
    return fallback;
  }

  const normalizedTag = normalizeLanguageTagParts(trimmed);
  if (!normalizedTag) {
    return fallback;
  }

  const prefix = getLanguagePrefix(normalizedTag);
  if (!normalizedTag.includes('-')) {
    return DEFAULT_LANGUAGE_BY_PREFIX[prefix] ?? normalizedTag.toLowerCase();
  }

  return normalizedTag;
}

export function parseExplicitLanguageSwitch(text: string): ExplicitLanguageSwitchResult {
  if (typeof text !== 'string' || !text.trim()) {
    return { detected: false, language: null };
  }

  const normalizedText = normalizeForMatching(text);
  if (!normalizedText) {
    return { detected: false, language: null };
  }

  const aliasLanguage = findAliasLanguage(normalizedText);
  const codeCandidate = extractCodeCandidate(text);
  const codeLanguage = codeCandidate ? normalizeConversationLanguage(codeCandidate, '') : '';
  const resolvedLanguage = aliasLanguage ?? (codeLanguage || null);
  const hasDirectiveVerb = EXPLICIT_SWITCH_PATTERNS.some((pattern) => pattern.test(normalizedText));
  const hasLanguageWord = EXPLICIT_LANGUAGE_WORD_PATTERN.test(normalizedText);
  const isShortLanguageOnlyRequest =
    normalizedText.split(' ').filter(Boolean).length <= 4 && Boolean(aliasLanguage ?? codeLanguage);
  const hasExplicitTarget = Boolean(extractExplicitTarget(normalizedText));
  const isExplicit = isShortLanguageOnlyRequest || (Boolean(resolvedLanguage) && (hasDirectiveVerb || hasLanguageWord)) || hasExplicitTarget;

  if (!isExplicit) {
    return { detected: false, language: null };
  }

  if (resolvedLanguage) {
    return {
      detected: true,
      language: normalizeConversationLanguage(resolvedLanguage, 'fr-CA')
    };
  }

  return {
    detected: true,
    language: null
  };
}

function detectScriptLanguage(text: string): string | null {
  if (/[\u0600-\u06ff]/.test(text)) {
    return 'ar-SA';
  }
  if (/[\u0400-\u04ff]/.test(text)) {
    return 'ru-RU';
  }
  if (/[\uac00-\ud7af]/.test(text)) {
    return 'ko-KR';
  }
  if (/[\u3040-\u30ff]/.test(text)) {
    return 'ja-JP';
  }
  if (/[\u4e00-\u9fff]/.test(text)) {
    return 'zh-CN';
  }
  return null;
}

function detectLatinLanguage(text: string): string | null {
  const tokens = tokenizeLatin(text);
  if (tokens.length < 3) {
    return null;
  }

  const scored = LATIN_LANGUAGE_SCORES.map((entry) => {
    const wordScore = tokens.reduce((score, token) => score + (entry.words.has(token) ? 1 : 0), 0);
    const patternScore = entry.patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
    const diacriticScore = entry.diacriticPattern && entry.diacriticPattern.test(text) ? 1 : 0;
    return {
      code: entry.code,
      score: wordScore + patternScore + diacriticScore
    };
  }).sort((left, right) => right.score - left.score);

  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < 2) {
    return null;
  }

  if (second && best.score - second.score < 1) {
    return null;
  }

  return best.code;
}

export function detectAutoConversationLanguage(text: string, currentLanguage: string): string | null {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }

  const scriptLanguage = detectScriptLanguage(text);
  if (scriptLanguage) {
    const nextLanguage = normalizeConversationLanguage(scriptLanguage, scriptLanguage);
    return getLanguagePrefix(nextLanguage) === getLanguagePrefix(currentLanguage) ? null : nextLanguage;
  }

  const latinLanguage = detectLatinLanguage(text);
  if (!latinLanguage) {
    return null;
  }

  const nextLanguage = normalizeConversationLanguage(latinLanguage, latinLanguage);
  return getLanguagePrefix(nextLanguage) === getLanguagePrefix(currentLanguage) ? null : nextLanguage;
}

export function resolveLanguageForTurn(text: string, currentLanguage: string): LanguageResolutionResult {
  const fallbackLanguage = normalizeConversationLanguage(currentLanguage, 'fr-CA');
  const explicit = parseExplicitLanguageSwitch(text);
  if (explicit.detected) {
    if (explicit.language) {
      return {
        language: normalizeConversationLanguage(explicit.language, fallbackLanguage),
        source: 'explicit',
        explicitDetected: true,
        explicitRecognized: true
      };
    }

    return {
      language: fallbackLanguage,
      source: 'current',
      explicitDetected: true,
      explicitRecognized: false
    };
  }

  const detected = detectAutoConversationLanguage(text, fallbackLanguage);
  if (detected) {
    return {
      language: detected,
      source: 'auto',
      explicitDetected: false,
      explicitRecognized: false
    };
  }

  return {
    language: fallbackLanguage,
    source: 'current',
    explicitDetected: false,
    explicitRecognized: false
  };
}
