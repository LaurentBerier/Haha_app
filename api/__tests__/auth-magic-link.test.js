const { createReqRes } = require('./testHelpers');

describe('api/auth-magic-link', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    AUTH_MAGIC_LINK_MAX_REQUESTS: process.env.AUTH_MAGIC_LINK_MAX_REQUESTS,
    AUTH_MAGIC_LINK_WINDOW_MS: process.env.AUTH_MAGIC_LINK_WINDOW_MS
  };

  const attachRequestId = jest.fn(() => 'req-auth-magic');
  const setCorsHeaders = jest.fn(() => ({ ok: true, reason: null }));
  const checkIpRateLimit = jest.fn(async () => ({ ok: true, retryAfterSeconds: 0 }));
  const getMissingEnv = jest.fn(() => []);
  const sendError = jest.fn((res, status, message, options = {}) => {
    res.status(status).json({
      error: {
        message,
        code: options.code
      }
    });
  });
  const log = jest.fn();

  const signInWithOtp = jest.fn(async () => ({ data: {}, error: null }));
  const createClient = jest.fn(() => ({
    auth: {
      signInWithOtp
    }
  }));

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    delete process.env.AUTH_MAGIC_LINK_MAX_REQUESTS;
    delete process.env.AUTH_MAGIC_LINK_WINDOW_MS;

    jest.doMock('../_utils', () => ({
      attachRequestId,
      setCorsHeaders,
      checkIpRateLimit,
      getMissingEnv,
      sendError,
      log
    }));

    jest.doMock('@supabase/supabase-js', () => ({
      createClient
    }));
  });

  afterEach(() => {
    if (typeof originalEnv.SUPABASE_URL === 'string') {
      process.env.SUPABASE_URL = originalEnv.SUPABASE_URL;
    } else {
      delete process.env.SUPABASE_URL;
    }

    if (typeof originalEnv.SUPABASE_ANON_KEY === 'string') {
      process.env.SUPABASE_ANON_KEY = originalEnv.SUPABASE_ANON_KEY;
    } else {
      delete process.env.SUPABASE_ANON_KEY;
    }

    if (typeof originalEnv.AUTH_MAGIC_LINK_MAX_REQUESTS === 'string') {
      process.env.AUTH_MAGIC_LINK_MAX_REQUESTS = originalEnv.AUTH_MAGIC_LINK_MAX_REQUESTS;
    } else {
      delete process.env.AUTH_MAGIC_LINK_MAX_REQUESTS;
    }

    if (typeof originalEnv.AUTH_MAGIC_LINK_WINDOW_MS === 'string') {
      process.env.AUTH_MAGIC_LINK_WINDOW_MS = originalEnv.AUTH_MAGIC_LINK_WINDOW_MS;
    } else {
      delete process.env.AUTH_MAGIC_LINK_WINDOW_MS;
    }
  });

  it('returns 405 for unsupported method', async () => {
    const handler = require('../auth-magic-link');
    const { req, res } = createReqRes({ method: 'GET' });

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.payload.error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('returns 400 when email is invalid', async () => {
    const handler = require('../auth-magic-link');
    const { req, res } = createReqRes({
      body: {
        email: 'invalid',
        intent: 'signin'
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('returns 429 when IP rate limit is exceeded and sets Retry-After', async () => {
    checkIpRateLimit.mockResolvedValueOnce({
      ok: false,
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded.',
      retryAfterSeconds: 120
    });

    const handler = require('../auth-magic-link');
    const { req, res } = createReqRes({
      body: {
        email: 'user@example.com',
        intent: 'signin'
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe('120');
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('sends a signin magic link with shouldCreateUser=false', async () => {
    const handler = require('../auth-magic-link');
    const { req, res } = createReqRes({
      headers: { origin: 'https://app.ha-ha.ai' },
      body: {
        email: 'USER@example.com',
        intent: 'signin'
      }
    });

    await handler(req, res);

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      options: {
        emailRedirectTo: 'https://app.ha-ha.ai/auth/callback',
        shouldCreateUser: false
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload.ok).toBe(true);
  });

  it('sends a signup magic link with shouldCreateUser=true and fallback callback URL', async () => {
    const handler = require('../auth-magic-link');
    const { req, res } = createReqRes({
      headers: {},
      body: {
        email: 'new-user@example.com',
        intent: 'signup'
      }
    });

    await handler(req, res);

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'new-user@example.com',
      options: {
        emailRedirectTo: 'hahaha://auth/callback',
        shouldCreateUser: true
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload.ok).toBe(true);
  });

  it('keeps a neutral 200 response when Supabase returns an auth error', async () => {
    signInWithOtp.mockResolvedValueOnce({
      data: {},
      error: { name: 'AuthApiError', message: 'User not found' }
    });

    const handler = require('../auth-magic-link');
    const { req, res } = createReqRes({
      body: {
        email: 'missing@example.com',
        intent: 'signin'
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({
      ok: true,
      message: "Si l'email est valide, un lien de connexion a ete envoye."
    });
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Supabase signInWithOtp returned error'),
      expect.objectContaining({
        requestId: 'req-auth-magic',
        capture: false
      })
    );
  });
});
