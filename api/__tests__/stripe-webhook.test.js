const { createHmac } = require('node:crypto');
const { createReqRes } = require('./testHelpers');

function signPayload(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function buildSupabaseMock({
  linkLookupUserId = '',
  targetUser = { id: 'user-1', app_metadata: { locale: 'fr-CA' } },
  duplicateEventCount = 0
} = {}) {
  const linksUpsert = jest.fn().mockResolvedValue({ error: null });
  const paymentInsert = jest.fn().mockResolvedValue({ error: null });
  const paymentSelectContains = jest.fn().mockResolvedValue({ count: duplicateEventCount, error: null });
  const profilesEq = jest.fn().mockResolvedValue({ error: null });
  const linksMaybeSingle = jest.fn().mockResolvedValue({
    data: linkLookupUserId ? { user_id: linkLookupUserId } : null,
    error: null
  });
  const updateUserById = jest.fn().mockResolvedValue({ error: null });
  const getUserById = jest.fn().mockResolvedValue({ data: { user: targetUser }, error: null });

  const from = jest.fn((table) => {
    if (table === 'stripe_customer_links') {
      return {
        upsert: linksUpsert,
        select: () => ({
          eq: () => ({
            maybeSingle: linksMaybeSingle
          })
        })
      };
    }

    if (table === 'payment_events') {
      return {
        insert: paymentInsert,
        select: () => ({
          eq: () => ({
            contains: paymentSelectContains
          })
        })
      };
    }

    if (table === 'profiles') {
      return {
        update: () => ({
          eq: profilesEq
        })
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    client: {
      from,
      auth: {
        admin: {
          getUserById,
          updateUserById
        }
      }
    },
    spies: { linksUpsert, paymentInsert, paymentSelectContains, profilesEq, linksMaybeSingle, getUserById, updateUserById }
  };
}

describe('api/stripe-webhook', () => {
  const originalEnv = {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PAYMENT_LINK_ID_REGULAR: process.env.STRIPE_PAYMENT_LINK_ID_REGULAR,
    STRIPE_PAYMENT_LINK_ID_PREMIUM: process.env.STRIPE_PAYMENT_LINK_ID_PREMIUM,
    STRIPE_PRICE_ID_REGULAR_MONTHLY: process.env.STRIPE_PRICE_ID_REGULAR_MONTHLY
  };

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
    process.env.STRIPE_PAYMENT_LINK_ID_REGULAR = 'plink_regular';
    process.env.STRIPE_PAYMENT_LINK_ID_PREMIUM = 'plink_premium';
    process.env.STRIPE_PRICE_ID_REGULAR_MONTHLY = 'price_regular_monthly';
    delete process.env.ALLOWED_ORIGINS;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (typeof value === 'string') {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    });
  });

  it('rejects webhook when signature is invalid', async () => {
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_123' } }
    });
    const supabase = buildSupabaseMock();

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../stripe-webhook');
    const { req, res } = createReqRes({
      headers: { 'stripe-signature': 't=1,v1=invalid' },
      body: payload
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects webhook when body is pre-parsed JSON (raw payload unavailable)', async () => {
    const event = {
      id: 'evt_missing_raw_body',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_123' } }
    };
    const supabase = buildSupabaseMock();
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../stripe-webhook');
    const { req, res } = createReqRes({
      headers: { 'stripe-signature': 't=1,v1=invalid' },
      body: event
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_MISCONFIGURED');
  });

  it('returns duplicate=true when Stripe event already exists', async () => {
    const event = {
      id: 'evt_duplicate_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_123', client_reference_id: 'user-1', payment_link: 'plink_regular' } }
    };
    const payload = JSON.stringify(event);
    const signature = signPayload(payload, process.env.STRIPE_WEBHOOK_SECRET);
    const supabase = buildSupabaseMock({ duplicateEventCount: 1 });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../stripe-webhook');
    const { req, res } = createReqRes({
      headers: { 'stripe-signature': signature },
      body: payload
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual(
      expect.objectContaining({
        ok: true,
        duplicate: true,
        type: 'checkout.session.completed'
      })
    );
    expect(supabase.spies.paymentInsert).not.toHaveBeenCalled();
  });

  it('processes checkout.session.completed and upgrades account type', async () => {
    const event = {
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          client_reference_id: 'user-1',
          customer: 'cus_123',
          subscription: 'sub_123',
          payment_link: 'plink_premium'
        }
      }
    };
    const payload = JSON.stringify(event);
    const signature = signPayload(payload, process.env.STRIPE_WEBHOOK_SECRET);
    const supabase = buildSupabaseMock();

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../stripe-webhook');
    const { req, res } = createReqRes({
      headers: { 'stripe-signature': signature },
      body: payload
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.accountTypeId).toBe('premium');
    expect(supabase.spies.paymentInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        provider: 'stripe',
        event_type: 'checkout_completed',
        account_type_id: 'premium'
      })
    );
    expect(supabase.spies.profilesEq).toHaveBeenCalledWith('id', 'user-1');
    expect(supabase.spies.updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: {
        locale: 'fr-CA',
        account_type: 'premium'
      }
    });
  });

  it('processes customer.subscription.deleted and downgrades to free', async () => {
    const event = {
      id: 'evt_sub_deleted_1',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          items: {
            data: [{ price: { id: 'price_regular_monthly' } }]
          }
        }
      }
    };
    const payload = JSON.stringify(event);
    const signature = signPayload(payload, process.env.STRIPE_WEBHOOK_SECRET);
    const supabase = buildSupabaseMock({ linkLookupUserId: 'user-1' });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../stripe-webhook');
    const { req, res } = createReqRes({
      headers: { 'stripe-signature': signature },
      body: payload
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.accountTypeId).toBe('free');
    expect(supabase.spies.profilesEq).toHaveBeenCalledWith('id', 'user-1');
    expect(supabase.spies.updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: {
        locale: 'fr-CA',
        account_type: 'free'
      }
    });
  });
});
