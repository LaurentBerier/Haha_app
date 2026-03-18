export const AUDIO_TAG_PATTERN = /\[[^\]\n]+\]/g;

export function stripAudioTags(text: string, options?: { trim?: boolean }): string {
  const cleaned = text.replace(AUDIO_TAG_PATTERN, '').replace(/[ \t]{2,}/g, ' ');
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
    trailingChunk.length <= 48 &&
    /^\[[A-Za-z\s-]*$/.test(trailingChunk);

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
