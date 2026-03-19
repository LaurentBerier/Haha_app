const SUPPORTED_AUDIO_TAGS = [
  'laughs harder',
  'laughing',
  'laughs',
  'scoffs',
  'sighs',
  'angry',
  'excited',
  'whispers'
] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const AUDIO_TAG_MATCHER = [...SUPPORTED_AUDIO_TAGS]
  .sort((left, right) => right.length - left.length)
  .map((tag) => escapeRegex(tag))
  .join('|');

export const AUDIO_TAG_PATTERN = new RegExp(`\\[\\s*(?:${AUDIO_TAG_MATCHER})\\s*\\]`, 'gi');
export const REACTION_TAG_PATTERN = /\[REACT:[^\]\n]{1,12}\]/gi;
const MAX_PARTIAL_TAG_LENGTH = 64;

function normalizePartialTagValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isPotentialSupportedAudioTagPrefix(partialTagChunk: string): boolean {
  if (!/^\[[^\]\n]*$/.test(partialTagChunk)) {
    return false;
  }

  const normalized = normalizePartialTagValue(partialTagChunk.slice(1));
  if (!normalized) {
    return true;
  }

  return SUPPORTED_AUDIO_TAGS.some((tag) => tag.startsWith(normalized));
}

export function stripReactionTags(text: string, options?: { trim?: boolean }): string {
  const cleaned = text.replace(REACTION_TAG_PATTERN, '').replace(/[ \t]{2,}/g, ' ');
  return options?.trim ? cleaned.trim() : cleaned;
}

export function stripAudioTags(text: string, options?: { trim?: boolean }): string {
  const withoutReactionTags = stripReactionTags(text);
  const cleaned = withoutReactionTags.replace(AUDIO_TAG_PATTERN, '').replace(/[ \t]{2,}/g, ' ');
  return options?.trim ? cleaned.trim() : cleaned;
}

export function normalizeSpeechText(text: string, options?: { trim?: boolean }): string {
  const cleaned = stripReactionTags(text).replace(/\s+/g, ' ');
  return options?.trim ? cleaned.trim() : cleaned;
}

export function splitDisplayChunkFromRaw(rawChunk: string): { displayChunk: string; pendingChunk: string } {
  if (!rawChunk) {
    return {
      displayChunk: '',
      pendingChunk: ''
    };
  }

  const lastOpenIndex = rawChunk.lastIndexOf('[');
  if (lastOpenIndex < 0) {
    return {
      displayChunk: stripAudioTags(rawChunk),
      pendingChunk: ''
    };
  }

  const trailingChunk = rawChunk.slice(lastOpenIndex);
  const looksLikePartialAudioTag =
    !trailingChunk.includes(']') &&
    trailingChunk.length <= MAX_PARTIAL_TAG_LENGTH &&
    isPotentialSupportedAudioTagPrefix(trailingChunk);

  if (!looksLikePartialAudioTag) {
    return {
      displayChunk: stripAudioTags(rawChunk),
      pendingChunk: ''
    };
  }

  const flushableChunk = rawChunk.slice(0, lastOpenIndex);
  return {
    displayChunk: stripAudioTags(flushableChunk),
    pendingChunk: trailingChunk
  };
}
