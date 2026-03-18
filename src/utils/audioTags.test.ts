import { splitDisplayChunkFromRaw, stripAudioTags } from './audioTags';

describe('audioTags', () => {
  it('strips audio tags from text', () => {
    const input = "[laughs] T'es sérieux?";
    expect(stripAudioTags(input, { trim: true })).toBe("T'es sérieux?");
  });

  it('keeps trailing partial tag buffered for next flush', () => {
    const result = splitDisplayChunkFromRaw("Bon, j'te vois venir [laugh");

    expect(result.displayChunk).toBe("Bon, j'te vois venir ");
    expect(result.pendingChunk).toBe('[laugh');
  });

  it('drops complete tags from display chunk', () => {
    const result = splitDisplayChunkFromRaw("[sighs] Ok, parfait.");

    expect(result.displayChunk.trim()).toBe('Ok, parfait.');
    expect(result.pendingChunk).toBe('');
  });
});
