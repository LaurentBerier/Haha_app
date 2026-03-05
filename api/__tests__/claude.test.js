const { createReqRes } = require('./testHelpers');

function buildSupabaseClient({ user = { id: 'user-1', app_metadata: {} } } = {}) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: 'invalid jwt' }
      })
    }
  };
}

describe('api/claude', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-api-key';
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
