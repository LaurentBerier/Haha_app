const { createReqRes } = require('./testHelpers');

function getMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function buildSupabaseMock({
  user = { id: 'admin-1', app_metadata: { role: 'admin', account_type: 'admin' } },
  previousCount = 42,
  previousResetAt = '2026-03-01T00:00:00.000Z',
  profileReadError = null,
  profileUpdateError = null
} = {}) {
  const getUser = jest.fn().mockResolvedValue({
    data: { user },
    error: user ? null : { message: 'invalid jwt' }
  });

  const profileMaybeSingle = jest.fn().mockResolvedValue({
    data: previousCount === null && previousResetAt === null
      ? null
      : {
          monthly_message_count: previousCount,
          monthly_reset_at: previousResetAt
        },
    error: profileReadError
  });
  const profileUpdateEq = jest.fn().mockResolvedValue({ error: profileUpdateError });
  const profileUpdate = jest.fn(() => ({ eq: profileUpdateEq }));
  const auditInsert = jest.fn().mockResolvedValue({ error: null });

  const from = jest.fn((table) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: profileMaybeSingle
          })
        }),
        update: profileUpdate
      };
    }

    if (table === 'audit_logs') {
      return {
        insert: auditInsert
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    client: {
      auth: { getUser },
      from
    },
    spies: { getUser, profileMaybeSingle, profileUpdate, profileUpdateEq, auditInsert }
  };
}

describe('api/admin-user-reset', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    KV_URL: process.env.KV_URL
  };

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ALLOWED_ORIGINS = 'https://admin.example.com';
    process.env.KV_URL = 'https://example-kv';
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

    if (typeof originalEnv.ALLOWED_ORIGINS === 'string') {
      process.env.ALLOWED_ORIGINS = originalEnv.ALLOWED_ORIGINS;
    } else {
      delete process.env.ALLOWED_ORIGINS;
    }

    if (typeof originalEnv.KV_URL === 'string') {
      process.env.KV_URL = originalEnv.KV_URL;
    } else {
      delete process.env.KV_URL;
    }
  });

  it('returns 401 when bearer token is missing', async () => {
    const supabase = buildSupabaseMock();
    const kvDel = jest.fn().mockResolvedValue(1);
    jest.doMock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => supabase.client) }));
    jest.doMock('@vercel/kv', () => ({ kv: { del: kvDel } }));

    const handler = require('../admin-user-reset');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: { origin: 'https://admin.example.com' },
      body: { userId: 'user-2' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload.error.code).toBe('UNAUTHORIZED');
    expect(kvDel).not.toHaveBeenCalled();
  });

  it('returns 403 for authenticated non-admin user', async () => {
    const supabase = buildSupabaseMock({
      user: { id: 'user-1', app_metadata: { role: 'user', account_type: 'regular' } }
    });
    const kvDel = jest.fn().mockResolvedValue(1);
    jest.doMock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => supabase.client) }));
    jest.doMock('@vercel/kv', () => ({ kv: { del: kvDel } }));

    const handler = require('../admin-user-reset');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: { authorization: 'Bearer user-token' },
      body: { userId: 'user-2' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.payload.error.code).toBe('FORBIDDEN');
    expect(kvDel).not.toHaveBeenCalled();
  });

  it('returns 400 when userId is missing', async () => {
    const supabase = buildSupabaseMock();
    const kvDel = jest.fn().mockResolvedValue(1);
    jest.doMock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => supabase.client) }));
    jest.doMock('@vercel/kv', () => ({ kv: { del: kvDel } }));

    const handler = require('../admin-user-reset');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: { authorization: 'Bearer admin-token' },
      body: {}
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
    expect(kvDel).not.toHaveBeenCalled();
  });

  it('resets monthly usage and clears quota cache key for current month', async () => {
    const supabase = buildSupabaseMock();
    const kvDel = jest.fn().mockResolvedValue(1);
    jest.doMock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => supabase.client) }));
    jest.doMock('@vercel/kv', () => ({ kv: { del: kvDel } }));

    const handler = require('../admin-user-reset');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: { authorization: 'Bearer admin-token' },
      body: { userId: 'user-2' }
    });

    await handler(req, res);

    const monthStartIso = getMonthStartIso();
    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      updatedBy: 'admin-1',
      userId: 'user-2',
      monthlyMessageCount: 0,
      monthlyResetAt: monthStartIso
    });

    expect(supabase.spies.profileUpdate).toHaveBeenCalledWith({
      monthly_message_count: 0,
      monthly_reset_at: monthStartIso
    });
    expect(supabase.spies.profileUpdateEq).toHaveBeenCalledWith('id', 'user-2');
    expect(kvDel).toHaveBeenCalledWith(`quota:user-2:${monthStartIso}`);
    expect(supabase.spies.auditInsert).toHaveBeenCalled();
  });
});
