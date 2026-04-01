const { createReqRes } = require('./testHelpers');

function buildSupabaseClient() {
  return {
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
}

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

function createAnthropicSuccessResponse() {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            themes: [
              {
                id: 1,
                type: 'perso_forte',
                titre: 'Le party tourne mal',
                premisse: 'Tu arrives pour une fete tranquille, mais une blague mal comprise te met au centre du chaos.'
              }
            ]
          })
        }
      ]
    })
  };
}

function setupModuleMocks() {
  const captureApiException = jest.fn();
  const supabaseClient = buildSupabaseClient();

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

describe('api/impro-themes upstream failures', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_FETCH_TIMEOUT_MS: process.env.ANTHROPIC_FETCH_TIMEOUT_MS,
    IMPRO_THEMES_FETCH_TIMEOUT_MS: process.env.IMPRO_THEMES_FETCH_TIMEOUT_MS
  };

  beforeEach(() => {
    jest.resetModules();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-api-key';
    process.env.ANTHROPIC_FETCH_TIMEOUT_MS = '25000';
    delete process.env.IMPRO_THEMES_FETCH_TIMEOUT_MS;
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

    if (typeof originalEnv.IMPRO_THEMES_FETCH_TIMEOUT_MS === 'string') {
      process.env.IMPRO_THEMES_FETCH_TIMEOUT_MS = originalEnv.IMPRO_THEMES_FETCH_TIMEOUT_MS;
    } else {
      delete process.env.IMPRO_THEMES_FETCH_TIMEOUT_MS;
    }
  });

  it('returns 503 and skips Sentry capture when upstream is overloaded', async () => {
    const { captureApiException } = setupModuleMocks();
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        createAnthropicErrorResponse({
          status: 529,
          message: 'Overloaded',
          type: 'overloaded_error',
          retryAfter: '11'
        })
      );

    const handler = require('../impro-themes');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: {
        authorization: 'Bearer user-token'
      },
      body: {}
    });

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('11');
    expect(res.payload.error.code).toBe('UPSTREAM_OVERLOADED');
    expect(captureApiException).not.toHaveBeenCalled();
  });

  it('returns 504 timeout errors and captures them', async () => {
    const { captureApiException } = setupModuleMocks();
    const timeoutError = new Error('aborted');
    timeoutError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(timeoutError);

    const handler = require('../impro-themes');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: {
        authorization: 'Bearer user-token'
      },
      body: {}
    });

    await handler(req, res);

    expect(res.statusCode).toBe(504);
    expect(res.payload.error.code).toBe('UPSTREAM_TIMEOUT');
    expect(captureApiException).toHaveBeenCalledTimes(1);
  });

  it('uses a safer impro-themes timeout floor when global timeout is lower', async () => {
    setupModuleMocks();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    global.fetch = jest.fn().mockResolvedValue(createAnthropicSuccessResponse());

    const handler = require('../impro-themes');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: {
        authorization: 'Bearer user-token'
      },
      body: {}
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const timeoutCall = setTimeoutSpy.mock.calls.find(([, delay]) => delay === 35000);
    expect(timeoutCall).toBeDefined();
  });

  it('honors IMPRO_THEMES_FETCH_TIMEOUT_MS when explicitly set', async () => {
    setupModuleMocks();
    process.env.IMPRO_THEMES_FETCH_TIMEOUT_MS = '47000';
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    global.fetch = jest.fn().mockResolvedValue(createAnthropicSuccessResponse());

    const handler = require('../impro-themes');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: {
        authorization: 'Bearer user-token'
      },
      body: {}
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const timeoutCall = setTimeoutSpy.mock.calls.find(([, delay]) => delay === 47000);
    expect(timeoutCall).toBeDefined();
  });
});
