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

import { buildTtsProxyCandidates, clearVoiceCacheOnSessionReset, fetchAndCacheVoice } from './ttsService';

describe('ttsService', () => {
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    jest.clearAllMocks();
    clearVoiceCacheOnSessionReset();
    (global as { window?: Window }).window = {
      location: {
        origin: 'https://app.ha-ha.ai'
      }
    } as unknown as Window;
    let urlCounter = 0;
    URL.createObjectURL = jest.fn(() => {
      urlCounter += 1;
      return `blob:https://app.ha-ha.ai/test-audio-${urlCounter}`;
    });
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    clearVoiceCacheOnSessionReset();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (typeof originalWindow === 'undefined') {
      delete (global as { window?: Window }).window;
    } else {
      global.window = originalWindow;
    }
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
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

  it('deduplicates identical in-flight TTS requests', async () => {
    const audioResponse = {
      ok: true,
      status: 200,
      headers: {
        get: (key: string) => (key === 'content-type' ? 'audio/mpeg' : null)
      },
      arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer
    };
    let resolveFetch!: (value: unknown) => void;
    const fetchMock = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const firstPromise = fetchAndCacheVoice('Salut Cathy', 'cathy-gauthier', 'fr-CA', 'token-premium');
    const secondPromise = fetchAndCacheVoice('Salut Cathy', 'cathy-gauthier', 'fr-CA', 'token-premium');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(audioResponse);

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('short-circuits repeated requests during terminal TTS cooldown windows', async () => {
    const rateLimitResponse = {
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
    const fetchMock = jest.fn().mockResolvedValue(rateLimitResponse);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      fetchAndCacheVoice('Salut Cathy', 'cathy-gauthier', 'fr-CA', 'token-premium', {
        throwOnError: true
      })
    ).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED'
    });

    await expect(
      fetchAndCacheVoice('Une autre ligne', 'cathy-gauthier', 'fr-CA', 'token-premium', {
        throwOnError: true
      })
    ).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED'
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears terminal cooldown state on session reset', async () => {
    const rateLimitResponse = {
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
    const successResponse = {
      ok: true,
      status: 200,
      headers: {
        get: (key: string) => (key === 'content-type' ? 'audio/mpeg' : null)
      },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    };
    const fetchMock = jest.fn().mockResolvedValueOnce(rateLimitResponse).mockResolvedValueOnce(successResponse);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      fetchAndCacheVoice('Salut Cathy', 'cathy-gauthier', 'fr-CA', 'token-premium', {
        throwOnError: true
      })
    ).rejects.toMatchObject({
      status: 429
    });

    clearVoiceCacheOnSessionReset();

    const uri = await fetchAndCacheVoice('Salut encore', 'cathy-gauthier', 'fr-CA', 'token-premium');
    expect(uri).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('supports explicit web voice-cache reset across auth/session boundaries', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (key: string) => (key === 'content-type' ? 'audio/mpeg' : null)
      },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await fetchAndCacheVoice('Salut Cathy', 'cathy-gauthier', 'fr-CA', 'token-premium');
    const second = await fetchAndCacheVoice('Salut Cathy', 'cathy-gauthier', 'fr-CA', 'token-premium');

    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearVoiceCacheOnSessionReset();

    const third = await fetchAndCacheVoice('Salut Cathy', 'cathy-gauthier', 'fr-CA', 'token-premium');
    expect(third).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);
  });

  it('evicts least-recently-used web voice cache entries and revokes their blob URLs', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (key: string) => (key === 'content-type' ? 'audio/mpeg' : null)
      },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const seedText = 'seed-text';
    await fetchAndCacheVoice(seedText, 'cathy-gauthier', 'fr-CA', 'token-premium');
    const initialFetchCount = fetchMock.mock.calls.length;

    for (let index = 0; index < 80; index += 1) {
      await fetchAndCacheVoice(`line-${index}`, 'cathy-gauthier', 'fr-CA', 'token-premium');
    }

    expect(URL.revokeObjectURL).toHaveBeenCalled();

    await fetchAndCacheVoice(seedText, 'cathy-gauthier', 'fr-CA', 'token-premium');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(initialFetchCount + 80);
  });
});
