import { normalizeSpeechText, splitDisplayChunkFromRaw, stripAudioTags } from './audioTags';

describe('audioTags', () => {
  it('strips audio tags from text', () => {
    const input = "[laughs] T'es sérieux?";
    expect(stripAudioTags(input, { trim: true })).toBe("T'es sérieux?");
  });

  it('keeps unsupported bracket content in display text', () => {
    const input = 'Je garde [pas-un-tag] tel quel.';
    expect(stripAudioTags(input, { trim: true })).toBe('Je garde [pas-un-tag] tel quel.');
  });

  it('normalizes speech text without removing supported audio tags', () => {
    const input = '[REACT:😂] [laughs]   Bon   ok';
    expect(normalizeSpeechText(input, { trim: true })).toBe('[laughs] Bon ok');
  });

  it('keeps trailing partial tag buffered for next flush', () => {
    const result = splitDisplayChunkFromRaw("Bon, j'te vois venir [laugh");

    expect(result.displayChunk).toBe("Bon, j'te vois venir ");
    expect(result.pendingChunk).toBe('[laugh');
  });

  it('does not buffer trailing unsupported bracket text', () => {
    const result = splitDisplayChunkFromRaw('Je veux voir [pas-un-tag');

    expect(result.displayChunk).toBe('Je veux voir [pas-un-tag');
    expect(result.pendingChunk).toBe('');
  });

  it('drops complete tags from display chunk', () => {
    const result = splitDisplayChunkFromRaw("[sighs] Ok, parfait.");

    expect(result.displayChunk.trim()).toBe('Ok, parfait.');
    expect(result.pendingChunk).toBe('');
  });
});
