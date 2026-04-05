const fetchAndCacheVoiceMock = jest.fn<Promise<string | null>, unknown[]>(async () => 'https://voice.test/filler.mp3');

jest.mock('./ttsService', () => ({
  fetchAndCacheVoice: (...args: unknown[]) => fetchAndCacheVoiceMock(...args)
}));

import { __resetVoiceFillerServiceForTests, getRandomFillerUri, prewarmVoiceFillers } from './voiceFillerService';

describe('voiceFillerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetVoiceFillerServiceForTests();
  });

  it('reuses the prewarmed filler on the first live filler request for the same scope', async () => {
    const randomSpy = jest.spyOn(Math, 'random');
    randomSpy.mockReturnValueOnce(0.99);
    prewarmVoiceFillers('cathy-gauthier', 'fr-CA', 'token-premium');

    randomSpy.mockReturnValueOnce(0);
    await getRandomFillerUri('cathy-gauthier', 'fr-CA', 'token-premium');

    expect(fetchAndCacheVoiceMock).toHaveBeenNthCalledWith(
      1,
      'Uh-huh...',
      'cathy-gauthier',
      'fr-CA',
      'token-premium',
      { purpose: 'reply' }
    );
    expect(fetchAndCacheVoiceMock).toHaveBeenNthCalledWith(
      2,
      'Uh-huh...',
      'cathy-gauthier',
      'fr-CA',
      'token-premium',
      { purpose: 'reply' }
    );

    randomSpy.mockRestore();
  });
});
