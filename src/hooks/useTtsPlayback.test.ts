import {
  extractReadyTtsChunksFromBuffer,
  MAX_TTS_CHUNK_CHARS,
  MIN_TTS_CHUNK_CHARS
} from './useTtsPlayback';

describe('useTtsPlayback chunk extraction', () => {
  it('prioritizes sentence boundaries before hard-length fallback', () => {
    const firstSentence =
      'Cathy enchaine une longue phrase bien complete pour garder un debit naturel et eviter une coupure brutale au milieu.';
    const secondSentence = 'Ensuite elle ajoute une seconde phrase claire pour confirmer que le decoupage reste propre.';
    expect(firstSentence.length).toBeGreaterThanOrEqual(MIN_TTS_CHUNK_CHARS);

    const { chunks, remainder } = extractReadyTtsChunksFromBuffer(`${firstSentence} ${secondSentence}`, false);
    expect(remainder).toBe('');
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(firstSentence);
    expect(chunks[1]).toBe(secondSentence);
  });

  it('does not drop a short trailing remainder on final flush', () => {
    const longSentence =
      'Voici une phrase suffisamment longue pour passer le seuil minimal, etre stable au TTS et conserver le rythme vocal.';
    const shortTail = 'Ok.';
    const { chunks, remainder } = extractReadyTtsChunksFromBuffer(`${longSentence} ${shortTail}`, true);

    expect(remainder).toBe('');
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain(longSentence);
    expect(chunks[0]).toContain(shortTail);
  });

  it('falls back to max-length chunking when text has no punctuation', () => {
    const noPunctuation = `cathy `.repeat(120).trim();
    const { chunks, remainder } = extractReadyTtsChunksFromBuffer(noPunctuation, false);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.length).toBeLessThanOrEqual(MAX_TTS_CHUNK_CHARS);
    expect(remainder.length).toBeGreaterThan(0);

    const final = extractReadyTtsChunksFromBuffer(remainder, true);
    expect(final.remainder).toBe('');
    expect(final.chunks.length).toBeGreaterThan(0);
  });
});
