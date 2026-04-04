const { createReqRes } = require('./testHelpers');

function buildSupabaseClient({
  user = { id: 'user-1', app_metadata: { account_type: 'free' } },
  stripeSubscriptionId = null,
  stripeLinkMaybeSingleError = null,
  stripeLinkListRows = null
} = {}) {
  const stripeLinkMaybeSingle = jest.fn().mockResolvedValue({
    data: stripeSubscriptionId ? { stripe_subscription_id: stripeSubscriptionId } : null,
    error: stripeLinkMaybeSingleError
  });

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: 'invalid jwt' }
      })
    },
    from: jest.fn((table) => {
      if (table === 'stripe_customer_links') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: stripeLinkMaybeSingle,
              limit: jest.fn().mockResolvedValue({
                data:
                  stripeLinkListRows ??
                  (stripeSubscriptionId
                    ? [
                        {
                          stripe_subscription_id: stripeSubscriptionId
                        }
                      ]
                    : []),
                error: null
              })
            })
          })
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    })
  };
}

describe('api/subscription-cancel', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_SECRET_KEY_TEST: process.env.STRIPE_SECRET_KEY_TEST,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY_TEST;
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

    if (typeof originalEnv.STRIPE_SECRET_KEY === 'string') {
      process.env.STRIPE_SECRET_KEY = originalEnv.STRIPE_SECRET_KEY;
    } else {
      delete process.env.STRIPE_SECRET_KEY;
    }

    if (typeof originalEnv.STRIPE_SECRET_KEY_TEST === 'string') {
      process.env.STRIPE_SECRET_KEY_TEST = originalEnv.STRIPE_SECRET_KEY_TEST;
    } else {
      delete process.env.STRIPE_SECRET_KEY_TEST;
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

    const handler = require('../subscription-cancel');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: { origin: 'https://app.example.com' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 404 when no stripe subscription is linked', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient({ stripeSubscriptionId: null }))
    }));

    const handler = require('../subscription-cancel');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.payload.error.code).toBe('NOT_FOUND');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 500 when stripe secret keys are missing', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'u-2', app_metadata: { account_type: 'premium' } },
          stripeSubscriptionId: 'sub_123'
        })
      )
    }));

    const handler = require('../subscription-cancel');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_MISCONFIGURED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns cancellation payload when stripe call succeeds', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_test';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        status: 'active',
        cancel_at_period_end: true,
        current_period_end: 1_710_000_000
      })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'u-3', app_metadata: { account_type: 'premium' } },
          stripeSubscriptionId: 'sub_456'
        })
      )
    }));

    const handler = require('../subscription-cancel');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.accountType).toBe('premium');
    expect(res.payload.cancelAtPeriodEnd).toBe(true);
    expect(res.payload.canCancel).toBe(false);
    expect(res.payload.nextBillingDate).toBe('2024-03-09T16:00:00.000Z');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to list query when maybeSingle returns ambiguous rows error', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_test';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        status: 'active',
        cancel_at_period_end: true,
        current_period_end: 1_710_000_000
      })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'u-legacy', app_metadata: { account_type: 'premium' } },
          stripeSubscriptionId: null,
          stripeLinkMaybeSingleError: {
            code: 'PGRST116',
            message: 'JSON object requested, multiple (or no) rows returned'
          },
          stripeLinkListRows: [
            { stripe_subscription_id: '' },
            { stripe_subscription_id: 'sub_legacy' }
          ]
        })
      )
    }));

    const handler = require('../subscription-cancel');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.cancelAtPeriodEnd).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
