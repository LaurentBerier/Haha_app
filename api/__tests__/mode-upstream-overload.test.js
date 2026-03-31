const { createReqRes } = require('./testHelpers');

function createAnthropicErrorResponse({ status, message, type, retryAfter }) {
  return {
    ok: false,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'retry-after' ? retryAfter ?? null : null;
      }
    },
    json: jest.fn().mockResolvedValue({
      error: {
        message,
        type
      }
    })
  };
}

function setupModuleMocks() {
  const captureApiException = jest.fn();
  const supabaseClient = {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user: {
            id: 'user-1',
            app_metadata: { account_type: 'free', role: 'user' }
          }
        },
        error: null
      })
    }
  };

  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => supabaseClient)
  }));

  jest.doMock('../_sentry', () => ({
    initApiSentry: jest.fn(),
    captureApiException
  }));

  jest.doMock('../_quota-utils', () => ({
    enforceMonthlyQuota: jest.fn().mockResolvedValue({
      ok: true,
      source: 'usage_events',
      monthStartIso: '2026-03-01T00:00:00.000Z',
      used: 0
    }),
    getRetryAfterUntilNextMonthSeconds: jest.fn(() => 123),
    parsePositiveInt: (value, fallback) => {
      const parsed = Number.parseInt(String(value ?? ''), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    },
    recordUsageEvent: jest.fn().mockResolvedValue({ ok: true }),
    writeProfileMonthlyCounter: jest.fn().mockResolvedValue({ ok: true })
  }));

  return { captureApiException };
}

function installOverloadedFetchMock() {
  const fetchMock = jest.fn().mockResolvedValue(
    createAnthropicErrorResponse({
      status: 529,
      message: 'Overloaded',
      type: 'overloaded_error',
      retryAfter: '11'
    })
  );
  global.fetch = fetchMock;
  return fetchMock;
}

describe('Anthropic overload handling for game modes', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_FETCH_TIMEOUT_MS: process.env.ANTHROPIC_FETCH_TIMEOUT_MS
  };

  beforeEach(() => {
    jest.resetModules();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-api-key';
    process.env.ANTHROPIC_FETCH_TIMEOUT_MS = '25000';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;

    if (typeof originalEnv.SUPABASE_URL === 'string') {
      process.env.SUPABASE_URL = originalEnv.SUPABASE_URL;
    } else {
      delete process.env.SUPABASE_URL;
    }

    if (typeof originalEnv.SUPABASE_SERVICE_ROLE_KEY === 'string') {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }

    if (typeof originalEnv.ANTHROPIC_API_KEY === 'string') {
      process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }

    if (typeof originalEnv.ANTHROPIC_FETCH_TIMEOUT_MS === 'string') {
      process.env.ANTHROPIC_FETCH_TIMEOUT_MS = originalEnv.ANTHROPIC_FETCH_TIMEOUT_MS;
    } else {
      delete process.env.ANTHROPIC_FETCH_TIMEOUT_MS;
    }
  });

  it('returns 503 from game-questions when upstream is overloaded', async () => {
    const { captureApiException } = setupModuleMocks();
    installOverloadedFetchMock();

    const handler = require('../game-questions');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: {
        authorization: 'Bearer user-token'
      },
      body: {
        artistId: 'cathy-gauthier',
        gameType: 'vrai-ou-invente',
        language: 'fr-CA'
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('11');
    expect(res.payload.error.code).toBe('UPSTREAM_OVERLOADED');
    expect(captureApiException).not.toHaveBeenCalled();
  });

  it('returns 503 from game-judge when upstream is overloaded', async () => {
    const { captureApiException } = setupModuleMocks();
    installOverloadedFetchMock();

    const handler = require('../game-judge');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: {
        authorization: 'Bearer user-token'
      },
      body: {
        artistId: 'cathy-gauthier',
        userRoast: 'Ton punchline a glisse sur une pelure de banane.',
        artistRoast: "J'te donne un 10 pour l'effort, un 2 pour l'impact.",
        language: 'fr-CA',
        round: 1,
        totalRounds: 3
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('11');
    expect(res.payload.error.code).toBe('UPSTREAM_OVERLOADED');
    expect(captureApiException).not.toHaveBeenCalled();
  });

  it('returns 503 from tarot-reading when upstream is overloaded', async () => {
    const { captureApiException } = setupModuleMocks();
    installOverloadedFetchMock();

    const handler = require('../tarot-reading');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: {
        authorization: 'Bearer user-token'
      },
      body: {
        artistId: 'cathy-gauthier',
        language: 'fr-CA',
        cards: [
          { name: 'La Lune', emoji: '🌙' },
          { name: 'Le Soleil', emoji: '☀️' },
          { name: 'La Roue de Fortune', emoji: '🎡' }
        ]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('11');
    expect(res.payload.error.code).toBe('UPSTREAM_OVERLOADED');
    expect(captureApiException).not.toHaveBeenCalled();
  });
});
