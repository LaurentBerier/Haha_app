const { createReqRes } = require('./testHelpers');

function buildSupabaseClient({
  user = { id: 'user-1', app_metadata: { account_type: 'free' } },
  usageCount = 0,
  usageError = null
} = {}) {
  const usageSelect = jest.fn().mockImplementation(() => ({
    eq: jest.fn().mockImplementation(() => ({
      eq: jest.fn().mockImplementation(() => ({
        gte: jest.fn().mockResolvedValue({
          count: usageCount,
          error: usageError
        })
      }))
    }))
  }));

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
          select: usageSelect
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    })
  };
}

describe('api/usage-summary', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CLAUDE_MONTHLY_CAP_PREMIUM: process.env.CLAUDE_MONTHLY_CAP_PREMIUM,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
  };

  beforeEach(() => {
    jest.resetModules();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';
    delete process.env.CLAUDE_MONTHLY_CAP_PREMIUM;
  });

  afterEach(() => {
    jest.restoreAllMocks();

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

    if (typeof originalEnv.CLAUDE_MONTHLY_CAP_PREMIUM === 'string') {
      process.env.CLAUDE_MONTHLY_CAP_PREMIUM = originalEnv.CLAUDE_MONTHLY_CAP_PREMIUM;
    } else {
      delete process.env.CLAUDE_MONTHLY_CAP_PREMIUM;
    }

    if (typeof originalEnv.ALLOWED_ORIGINS === 'string') {
      process.env.ALLOWED_ORIGINS = originalEnv.ALLOWED_ORIGINS;
    } else {
      delete process.env.ALLOWED_ORIGINS;
    }
  });

  it('returns 401 when bearer token is missing', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../usage-summary');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { origin: 'https://app.example.com' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload.error.code).toBe('UNAUTHORIZED');
  });

  it('returns tier usage summary for paid user', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'regular-user', app_metadata: { account_type: 'regular' } },
          usageCount: 380
        })
      )
    }));

    const handler = require('../usage-summary');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { authorization: 'Bearer regular-token' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.messagesUsed).toBe(380);
    expect(res.payload.messagesCap).toBe(500);
    expect(res.payload.softCapReached).toBe(true);
    expect(res.payload.economyMode).toBe(false);
  });

  it('uses env monthly cap override when configured', async () => {
    process.env.CLAUDE_MONTHLY_CAP_PREMIUM = '2000';
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'premium-user', app_metadata: { account_type: 'premium' } },
          usageCount: 1700
        })
      )
    }));

    const handler = require('../usage-summary');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { authorization: 'Bearer premium-token' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.messagesCap).toBe(2000);
    expect(res.payload.softCapReached).toBe(true);
    expect(res.payload.economyMode).toBe(false);
  });

  it('returns unlimited cap for admin users', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'admin-user', app_metadata: { account_type: 'admin' } },
          usageCount: 99999
        })
      )
    }));

    const handler = require('../usage-summary');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { authorization: 'Bearer admin-token' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.messagesCap).toBeNull();
    expect(res.payload.softCapReached).toBe(false);
    expect(res.payload.economyMode).toBe(false);
  });
});
