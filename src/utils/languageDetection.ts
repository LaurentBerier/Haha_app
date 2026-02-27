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

const ENGLISH_PHRASE_PATTERNS = [/\bi am\b/i, /\bi want\b/i, /\bcan you\b/i, /\bplease\b/i];
const FRENCH_PHRASE_PATTERNS = [/\bje (?:suis|veux|peux)\b/i, /\btu (?:es|veux|peux)\b/i, /\bs'il\b/i, /\bqu['’]/i];
const FRENCH_DIACRITIC_PATTERN = /[àâäæçéèêëîïôöœùûüÿ]/i;
const MIN_WORD_COUNT = 3;
const MIN_ENGLISH_SCORE = 3;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-zA-ZÀ-ÿ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function shouldAutoSwitchToEnglish(text: string, currentLanguage: string): boolean {
  if (!text || currentLanguage.toLowerCase().startsWith('en')) {
    return false;
  }

  if (FRENCH_DIACRITIC_PATTERN.test(text)) {
    return false;
  }

  const words = tokenize(text);
  if (words.length < MIN_WORD_COUNT) {
    return false;
  }

  const englishWordScore = words.reduce((score, word) => score + (ENGLISH_HINT_WORDS.has(word) ? 1 : 0), 0);
  const frenchWordScore = words.reduce((score, word) => score + (FRENCH_HINT_WORDS.has(word) ? 1 : 0), 0);

  const englishPatternScore = ENGLISH_PHRASE_PATTERNS.reduce(
    (score, pattern) => score + (pattern.test(text) ? 1 : 0),
    0
  );
  const frenchPatternScore = FRENCH_PHRASE_PATTERNS.reduce(
    (score, pattern) => score + (pattern.test(text) ? 1 : 0),
    0
  );

  const englishScore = englishWordScore + englishPatternScore;
  const frenchScore = frenchWordScore + frenchPatternScore;

  return englishScore >= MIN_ENGLISH_SCORE && englishScore > frenchScore;
}
