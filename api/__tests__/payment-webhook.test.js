const { createReqRes } = require('./testHelpers');

function buildPaymentEventsTable({ insert, upsertData = [{ id: 'event-1' }], upsertError = null } = {}) {
  const upsertSelect = jest.fn().mockResolvedValue({ data: upsertData, error: upsertError });
  const upsert = jest.fn().mockReturnValue({
    select: upsertSelect
  });

  return {
    insert: insert ?? jest.fn().mockResolvedValue({ error: null }),
    upsert,
    __spies: {
      upsert,
      upsertSelect
    }
  };
}

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
    const profileMaybeSingle = jest.fn().mockResolvedValue({
      data: { account_type_id: 'free' },
      error: null
    });
    const getUserById = jest.fn().mockResolvedValue({
      data: { user: { app_metadata: { locale: 'fr-CA' } } },
      error: null
    });
    const updateUserById = jest.fn().mockResolvedValue({ error: null });
    const paymentEvents = buildPaymentEventsTable({ insert });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({
        from: jest.fn((table) => {
          if (table === 'payment_events') {
            return paymentEvents;
          }

          if (table === 'profiles') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: profileMaybeSingle
                })
              }),
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

  it('rolls back profile tier when metadata update fails', async () => {
    process.env.REVENUECAT_WEBHOOK_SECRET = 'top-secret';
    const insert = jest.fn().mockResolvedValue({ error: null });
    const updateProfileEq = jest
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null });
    const updateProfile = jest.fn(() => ({
      eq: updateProfileEq
    }));
    const profileMaybeSingle = jest.fn().mockResolvedValue({
      data: { account_type_id: 'free' },
      error: null
    });
    const getUserById = jest.fn().mockResolvedValue({
      data: { user: { app_metadata: { locale: 'fr-CA' } } },
      error: null
    });
    const updateUserById = jest.fn().mockResolvedValue({ error: { message: 'metadata update failed' } });
    const paymentEvents = buildPaymentEventsTable({ insert });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({
        from: jest.fn((table) => {
          if (table === 'payment_events') {
            return paymentEvents;
          }

          if (table === 'profiles') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: profileMaybeSingle
                })
              }),
              update: updateProfile
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

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.message).toBe('Failed to process webhook event.');
    expect(updateProfile).toHaveBeenNthCalledWith(1, { account_type_id: 'premium' });
    expect(updateProfile).toHaveBeenNthCalledWith(2, { account_type_id: 'free' });
    expect(updateProfileEq).toHaveBeenNthCalledWith(1, 'id', 'user-1');
    expect(updateProfileEq).toHaveBeenNthCalledWith(2, 'id', 'user-1');
  });

  it('returns duplicate=true when RevenueCat event already exists', async () => {
    process.env.REVENUECAT_WEBHOOK_SECRET = 'top-secret';
    const insert = jest.fn().mockResolvedValue({ error: null });
    const paymentEvents = buildPaymentEventsTable({ insert, upsertData: [] });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({
        from: jest.fn((table) => {
          if (table === 'payment_events') {
            return paymentEvents;
          }

          if (table === 'profiles') {
            return {
              update: () => ({
                eq: jest.fn().mockResolvedValue({ error: null })
              })
            };
          }

          throw new Error(`Unexpected table: ${table}`);
        }),
        auth: {
          admin: {
            getUserById: jest.fn().mockResolvedValue({
              data: { user: { app_metadata: { locale: 'fr-CA' } } },
              error: null
            }),
            updateUserById: jest.fn().mockResolvedValue({ error: null })
          }
        }
      }))
    }));

    const handler = require('../payment-webhook');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer top-secret' },
      body: {
        event: {
          id: 'evt_revcat_dup_1',
          type: 'INITIAL_PURCHASE',
          app_user_id: 'user-1',
          product_id: 'haha_regular_monthly'
        }
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual(
      expect.objectContaining({
        ok: true,
        duplicate: true,
        userId: 'user-1'
      })
    );
    expect(paymentEvents.__spies.upsert).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });
});
