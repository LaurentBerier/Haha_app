jest.mock('../../config/env', () => ({
  API_BASE_URL: 'https://example.test/api',
  CLAUDE_PROXY_URL: '',
  GREETING_FORCE_TUTORIAL: false
}));

import {
  __resetModeSelectGreetingApiBackoffForTest,
  fetchModeSelectGreetingFromApi
} from '../../app/mode-select/greetingService';

describe('mode-select greetingService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    __resetModeSelectGreetingApiBackoffForTest();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns a trimmed greeting and tutorial metadata from API', async () => {
    (global.fetch as unknown as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        greeting: '  Salut, bienvenue.  ',
        tutorial: { active: true, sessionIndex: 1, connectionLimit: 1 }
      })
    });

    const result = await fetchModeSelectGreetingFromApi({
      artistId: 'cathy-gauthier',
      language: 'fr-CA',
      accessToken: 'token-1',
      coords: null,
      availableModes: ['On Jase'],
      preferredName: 'Laurent',
      isSessionFirstGreeting: true
    });

    expect(result).toEqual({
      greeting: 'Salut, bienvenue.',
      tutorial: {
        active: true,
        sessionIndex: 1,
        connectionLimit: 1
      },
      timedOut: false
    });
  });

  it('returns null greeting without fetch when access token is missing', async () => {
    const result = await fetchModeSelectGreetingFromApi({
      artistId: 'cathy-gauthier',
      language: 'fr-CA',
      accessToken: '   ',
      coords: null,
      availableModes: ['On Jase'],
      preferredName: null,
      isSessionFirstGreeting: true
    });

    expect(result).toEqual({
      greeting: null,
      tutorial: null,
      timedOut: false
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('retries with a global budget and reports timedOut when budget is exhausted', async () => {
    let now = 0;
    const fetchMock = jest.fn(async () => {
      now += 700;
      throw new Error('network down');
    });

    const result = await fetchModeSelectGreetingFromApi(
      {
        artistId: 'cathy-gauthier',
        language: 'fr-CA',
        accessToken: 'token-budget',
        coords: null,
        availableModes: ['On Jase'],
        preferredName: null,
        isSessionFirstGreeting: true
      },
      {
        fetchImpl: fetchMock as unknown as typeof fetch,
        nowMs: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        requestTimeoutMs: 700,
        retryBaseDelayMs: 300,
        totalBudgetMs: 2_100
      }
    );

    expect(result).toEqual({
      greeting: null,
      tutorial: null,
      timedOut: true
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});
