jest.mock('../../config/env', () => ({
  API_BASE_URL: 'https://example.test/api',
  CLAUDE_PROXY_URL: ''
}));

import { __resetGameGreetingApiBackoffForTest, fetchGameGreetingFromApi } from './gameGreetingService';

describe('gameGreetingService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    __resetGameGreetingApiBackoffForTest();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns a trimmed greeting from the API when available', async () => {
    (global.fetch as unknown as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ greeting: '  Salut, partie ouverte.  ' })
    });

    const greeting = await fetchGameGreetingFromApi({
      artistId: 'cathy-gauthier',
      language: 'fr-CA',
      accessToken: 'token-1',
      recentExperienceName: 'Tirage de Tarot'
    });

    expect(greeting).toBe('Salut, partie ouverte.');
    expect(global.fetch).toHaveBeenCalled();
  });

  it('returns null without calling fetch when access token is missing', async () => {
    const greeting = await fetchGameGreetingFromApi({
      artistId: 'cathy-gauthier',
      language: 'fr-CA',
      accessToken: '   '
    });

    expect(greeting).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('enters backoff after transient failures and skips immediate retries', async () => {
    (global.fetch as unknown as jest.Mock).mockRejectedValue(new Error('network down'));

    const first = await fetchGameGreetingFromApi({
      artistId: 'cathy-gauthier',
      language: 'fr-CA',
      accessToken: 'token-2',
      recentExperienceName: 'Vrai ou Inventé'
    });

    expect(first).toBeNull();
    expect((global.fetch as unknown as jest.Mock).mock.calls.length).toBeGreaterThan(0);

    (global.fetch as unknown as jest.Mock).mockClear();
    (global.fetch as unknown as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ greeting: 'Should be skipped by backoff' })
    });

    const second = await fetchGameGreetingFromApi({
      artistId: 'cathy-gauthier',
      language: 'fr-CA',
      accessToken: 'token-2',
      recentExperienceName: 'Vrai ou Inventé'
    });

    expect(second).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
