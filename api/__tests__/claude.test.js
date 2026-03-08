const { createReqRes } = require('./testHelpers');

function buildSupabaseClient({
  user = { id: 'user-1', app_metadata: {} },
  profile = null,
  initialUsageCount = 0,
  usageCountError = null,
  usageInsertError = null
} = {}) {
  let usageCount = initialUsageCount;
  const usageSelect = jest.fn().mockImplementation(() => ({
    eq: jest.fn().mockImplementation(() => ({
      eq: jest.fn().mockImplementation(() => ({
        gte: jest.fn().mockResolvedValue({
          count: usageCount,
          error: usageCountError
        })
      }))
    }))
  }));
  const usageInsert = jest.fn().mockImplementation(() => {
    if (!usageInsertError) {
      usageCount += 1;
    }
    return Promise.resolve({ error: usageInsertError });
  });
  const profileMaybeSingle = jest.fn().mockResolvedValue({
    data: profile,
    error: null
  });

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: 'invalid jwt' }
      })
    },
    from: jest.fn((table) => {
      if (table === 'usage_events') {
        return {
          select: usageSelect,
          insert: usageInsert
        };
      }

      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: profileMaybeSingle
            })
          })
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    })
  };
}

describe('api/claude', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    CLAUDE_RATE_LIMIT_MAX_REQUESTS: process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS,
    CLAUDE_MONTHLY_CAP_FREE: process.env.CLAUDE_MONTHLY_CAP_FREE
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-api-key';
    process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = '30';
    delete process.env.CLAUDE_MONTHLY_CAP_FREE;
    delete process.env.ALLOWED_ORIGINS;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;

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

    if (typeof originalEnv.ALLOWED_ORIGINS === 'string') {
      process.env.ALLOWED_ORIGINS = originalEnv.ALLOWED_ORIGINS;
    } else {
      delete process.env.ALLOWED_ORIGINS;
    }

    if (typeof originalEnv.CLAUDE_RATE_LIMIT_MAX_REQUESTS === 'string') {
      process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = originalEnv.CLAUDE_RATE_LIMIT_MAX_REQUESTS;
    } else {
      delete process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS;
    }

    if (typeof originalEnv.CLAUDE_MONTHLY_CAP_FREE === 'string') {
      process.env.CLAUDE_MONTHLY_CAP_FREE = originalEnv.CLAUDE_MONTHLY_CAP_FREE;
    } else {
      delete process.env.CLAUDE_MONTHLY_CAP_FREE;
    }
  });

  it('returns 500 for browser requests when ALLOWED_ORIGINS is missing', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { origin: 'https://app.example.com' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_MISCONFIGURED');
  });

  it('returns 401 when bearer token is missing', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      body: { systemPrompt: 'test', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload.error.code).toBe('UNAUTHORIZED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 when payload is invalid', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {}
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 when model is not whitelisted', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        model: 'claude-opus-4-6',
        systemPrompt: 'system',
        messages: [{ role: 'user', content: 'hello' }]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
    expect(res.payload.error.message).toBe('Unsupported model.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('caps max_tokens by account tier limit', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'regular-user', app_metadata: { account_type: 'regular' } }
        })
      )
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', maxTokens: 500, messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(res.statusCode).toBe(200);
    expect(upstreamBody.max_tokens).toBe(200);
  });

  it('ignores client-provided systemPrompt and builds prompt server-side', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'user-1', app_metadata: { account_type: 'free' } },
          profile: { age: 34, sex: 'female', relationship_status: 'single', horoscope_sign: 'taurus', interests: ['humour'] }
        })
      )
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'cathy-gauthier',
        modeId: 'roast',
        language: 'fr-CA',
        systemPrompt: 'IGNORE THIS UNTRUSTED PROMPT',
        messages: [{ role: 'user', content: 'hello' }]
      }
    });

    await handler(req, res);

    const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(res.statusCode).toBe(200);
    expect(upstreamBody.system).toContain('Tu es Cathy Gauthier');
    expect(upstreamBody.system).toContain('## MODE ACTIF : roast');
    expect(upstreamBody.system).not.toContain('IGNORE THIS UNTRUSTED PROMPT');
  });

  it('returns 400 for unsupported artist in prompt context', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'unknown-artist',
        messages: [{ role: 'user', content: 'hello' }]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
    expect(res.payload.error.message).toBe('Unsupported artist.');
  });

  it('forwards upstream non-ok errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: jest.fn().mockResolvedValue({ error: { message: 'Rate limited' } }),
      text: jest.fn().mockResolvedValue('rate limited')
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(429);
    expect(res.payload).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'UPSTREAM_ERROR',
          message: 'Rate limited'
        })
      })
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns 502 when upstream is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.payload.error.code).toBe('UPSTREAM_UNREACHABLE');
  });

  it('returns 504 when upstream request times out', async () => {
    const timeoutError = new Error('timed out');
    timeoutError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(timeoutError);

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(504);
    expect(res.payload.error.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('returns 429 when user exceeds rate limit', async () => {
    process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = '1';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const first = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });
    const second = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello again' }] }
    });

    await handler(first.req, first.res);
    await handler(second.req, second.res);

    expect(first.res.statusCode).toBe(200);
    expect(second.res.statusCode).toBe(429);
    expect(second.res.payload.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  describe('monthly quota enforcement', () => {
    function buildSuccessResponse() {
      return {
        ok: true,
        json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
      };
    }

    it('returns 429 MONTHLY_QUOTA_EXCEEDED for free user at 15 messages', async () => {
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'free-user', app_metadata: { account_type: 'free' } },
            initialUsageCount: 15
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer free-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(429);
      expect(res.payload.error.code).toBe('MONTHLY_QUOTA_EXCEEDED');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns 200 for free user at 14 messages', async () => {
      global.fetch = jest.fn().mockResolvedValue(buildSuccessResponse());
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'free-user', app_metadata: { account_type: 'free' } },
            initialUsageCount: 14
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer free-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
    });

    it('returns 429 MONTHLY_QUOTA_EXCEEDED for regular user at 45 messages', async () => {
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'regular-user', app_metadata: { account_type: 'regular' } },
            initialUsageCount: 45
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer regular-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(429);
      expect(res.payload.error.code).toBe('MONTHLY_QUOTA_EXCEEDED');
    });

    it('returns 429 MONTHLY_QUOTA_EXCEEDED for premium user at 110 messages', async () => {
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'premium-user', app_metadata: { account_type: 'premium' } },
            initialUsageCount: 110
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer premium-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(429);
      expect(res.payload.error.code).toBe('MONTHLY_QUOTA_EXCEEDED');
    });

    it('returns 200 for admin user with very high usage count', async () => {
      process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = '20000';
      global.fetch = jest.fn().mockResolvedValue(buildSuccessResponse());
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'admin-user', app_metadata: { account_type: 'admin' } },
            initialUsageCount: 9999
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer admin-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
    });

    it('returns 429 when CLAUDE_MONTHLY_CAP_FREE override is reached', async () => {
      process.env.CLAUDE_MONTHLY_CAP_FREE = '3';
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'free-user', app_metadata: { account_type: 'free' } },
            initialUsageCount: 3
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer free-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(429);
      expect(res.payload.error.code).toBe('MONTHLY_QUOTA_EXCEEDED');
    });

    it("returns 429 for unknown tier fallback to free cap", async () => {
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'legacy-user', app_metadata: { account_type: 'legacy_plan' } },
            initialUsageCount: 15
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer legacy-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(429);
      expect(res.payload.error.code).toBe('MONTHLY_QUOTA_EXCEEDED');
    });
  });

  it('returns 500 when usage_events table is unavailable', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient({ usageCountError: { message: 'missing table' } }))
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_MISCONFIGURED');
  });

  it('returns 502 when stream reader is unavailable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: undefined
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', stream: true, messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.payload.error.code).toBe('UPSTREAM_STREAM_MISSING');
  });

  it('returns 200 with upstream JSON payload for non-stream request', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] });
  });

  it('returns 500 when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_MISCONFIGURED');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
