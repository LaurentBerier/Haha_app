jest.mock('../config/env', () => ({
  API_BASE_URL: 'https://api.ha-ha.ai',
  CLAUDE_PROXY_URL: 'https://proxy.ha-ha.ai/claude'
}));

jest.mock('react-native', () => ({
  Platform: {
    OS: 'web'
  }
}));

jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///tmp/',
  getInfoAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  EncodingType: {
    Base64: 'base64'
  }
}));

import { buildTtsProxyCandidates, fetchAndCacheVoice } from './ttsService';

describe('ttsService', () => {
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  const originalCreateObjectURL = URL.createObjectURL;

  beforeEach(() => {
    jest.clearAllMocks();
    (global as { window?: Window }).window = {
      location: {
        origin: 'https://app.ha-ha.ai'
      }
    } as unknown as Window;
    URL.createObjectURL = jest.fn(() => 'blob:https://app.ha-ha.ai/test-audio');
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (typeof originalWindow === 'undefined') {
      delete (global as { window?: Window }).window;
    } else {
      global.window = originalWindow;
    }
    URL.createObjectURL = originalCreateObjectURL;
  });

  it('prioritizes same-origin web endpoints before cross-origin proxy endpoints', () => {
    expect(buildTtsProxyCandidates()).toEqual([
      'https://app.ha-ha.ai/api/tts',
      '/api/tts',
      'https://api.ha-ha.ai/tts',
      'https://proxy.ha-ha.ai/tts'
    ]);
  });

  it('stops endpoint failover after terminal 403 response', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: {
          get: () => 'application/json'
        }
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const uri = await fetchAndCacheVoice('Salut Cathy', 'cathy-gauthier', 'fr-CA', 'token-premium');

    expect(uri).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://app.ha-ha.ai/api/tts');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/tts');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(Object)
      })
    );
  });

  it('throws structured terminal error with retry-after when throwOnError is enabled', async () => {
    const response = {
      ok: false,
      status: 429,
      headers: {
        get: (key: string) => {
          if (key === 'content-type') {
            return 'application/json';
          }
          if (key === 'retry-after') {
            return '17';
          }
          return null;
        }
      },
      clone: () => ({
        json: async () => ({
          error: {
            code: 'RATE_LIMIT_EXCEEDED'
          }
        })
      })
    };
    global.fetch = jest.fn().mockResolvedValue(response) as unknown as typeof fetch;

    await expect(
      fetchAndCacheVoice('Salut Cathy', 'cathy-gauthier', 'fr-CA', 'token-premium', {
        throwOnError: true
      })
    ).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfterSeconds: 17
    });
  });
});
