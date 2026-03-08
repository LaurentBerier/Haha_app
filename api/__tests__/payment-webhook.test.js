const { createReqRes } = require('./testHelpers');

describe('api/payment-webhook', () => {
  const originalEnv = {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    REVENUECAT_WEBHOOK_SECRET: process.env.REVENUECAT_WEBHOOK_SECRET
  };

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    delete process.env.ALLOWED_ORIGINS;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (typeof originalEnv.ALLOWED_ORIGINS === 'string') {
      process.env.ALLOWED_ORIGINS = originalEnv.ALLOWED_ORIGINS;
    } else {
      delete process.env.ALLOWED_ORIGINS;
    }

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

    if (typeof originalEnv.REVENUECAT_WEBHOOK_SECRET === 'string') {
      process.env.REVENUECAT_WEBHOOK_SECRET = originalEnv.REVENUECAT_WEBHOOK_SECRET;
    } else {
      delete process.env.REVENUECAT_WEBHOOK_SECRET;
    }
  });

  it('fails closed when webhook secret is missing', async () => {
    delete process.env.REVENUECAT_WEBHOOK_SECRET;

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({}))
    }));

    const handler = require('../payment-webhook');
    const { req, res } = createReqRes({
      body: { event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'haha_regular_monthly' } }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'SERVER_MISCONFIGURED'
        })
      })
    );
  });

  it('rejects invalid bearer token when secret is set', async () => {
    process.env.REVENUECAT_WEBHOOK_SECRET = 'top-secret';

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({}))
    }));

    const handler = require('../payment-webhook');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer wrong-secret' },
      body: { event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'haha_regular_monthly' } }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'UNAUTHORIZED'
        })
      })
    );
  });

  it('rejects near-match token safely', async () => {
    process.env.REVENUECAT_WEBHOOK_SECRET = 'top-secret';

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({}))
    }));

    const handler = require('../payment-webhook');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer top-secreu' },
      body: { event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'haha_regular_monthly' } }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'UNAUTHORIZED'
        })
      })
    );
  });

  it('merges existing app_metadata when syncing account type', async () => {
    process.env.REVENUECAT_WEBHOOK_SECRET = 'top-secret';
    const insert = jest.fn().mockResolvedValue({ error: null });
    const updateProfileEq = jest.fn().mockResolvedValue({ error: null });
    const getUserById = jest.fn().mockResolvedValue({
      data: { user: { app_metadata: { locale: 'fr-CA' } } },
      error: null
    });
    const updateUserById = jest.fn().mockResolvedValue({ error: null });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({
        from: jest.fn((table) => {
          if (table === 'payment_events') {
            return { insert };
          }

          if (table === 'profiles') {
            return {
              update: () => ({
                eq: updateProfileEq
              })
            };
          }

          throw new Error(`Unexpected table: ${table}`);
        }),
        auth: {
          admin: {
            getUserById,
            updateUserById
          }
        }
      }))
    }));

    const handler = require('../payment-webhook');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer top-secret' },
      body: { event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'haha_premium_monthly' } }
    });

    await handler(req, res);

    expect(updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: {
        locale: 'fr-CA',
        account_type: 'premium'
      }
    });
    expect(res.statusCode).toBe(200);
  });
});
