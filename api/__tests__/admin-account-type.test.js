const { createReqRes } = require('./testHelpers');

function buildSupabaseMock({
  user = { id: 'admin-1', app_metadata: { role: 'admin', account_type: 'admin' } },
  targetUser = { id: 'user-2', app_metadata: { locale: 'fr-CA' } },
  accountTypeExists = true,
  profileUpdateError = null,
  metadataUpdateError = null
} = {}) {
  const getUser = jest.fn().mockResolvedValue({
    data: { user },
    error: user ? null : { message: 'invalid jwt' }
  });
  const maybeSingle = jest.fn().mockResolvedValue({
    data: accountTypeExists ? { id: 'premium' } : null,
    error: null
  });
  const profileUpdateEq = jest.fn().mockResolvedValue({ error: profileUpdateError });
  const updateUserById = jest.fn().mockResolvedValue({ error: metadataUpdateError });
  const getUserById = jest.fn().mockResolvedValue({
    data: { user: targetUser },
    error: null
  });

  const from = jest.fn((table) => {
    if (table === 'account_types') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle
          })
        })
      };
    }

    if (table === 'profiles') {
      return {
        update: () => ({
          eq: profileUpdateEq
        })
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    client: {
      auth: {
        getUser,
        admin: {
          updateUserById,
          getUserById
        }
      },
      from
    },
    spies: { getUser, maybeSingle, profileUpdateEq, updateUserById, getUserById }
  };
}

describe('api/admin-account-type', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
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
  });

  it('returns 403 for authenticated non-admin user', async () => {
    const supabase = buildSupabaseMock({
      user: { id: 'user-1', app_metadata: { role: 'user', account_type: 'regular' } }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-account-type');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer user-token' },
      body: { userId: 'user-2', accountTypeId: 'premium' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.payload.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 when required fields are missing', async () => {
    const supabase = buildSupabaseMock();
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-account-type');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer admin-token' },
      body: {}
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 401 when bearer token is missing', async () => {
    const supabase = buildSupabaseMock();
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-account-type');
    const { req, res } = createReqRes({
      body: { userId: 'user-2', accountTypeId: 'premium' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 for unknown account type', async () => {
    const supabase = buildSupabaseMock({ accountTypeExists: false });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-account-type');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer admin-token' },
      body: { userId: 'user-2', accountTypeId: 'not-a-tier' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
    expect(supabase.spies.updateUserById).not.toHaveBeenCalled();
  });

  it('updates profile and auth metadata for valid admin request', async () => {
    const supabase = buildSupabaseMock();
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-account-type');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer admin-token' },
      body: { userId: 'user-2', accountTypeId: 'premium' }
    });

    await handler(req, res);

    expect(supabase.spies.profileUpdateEq).toHaveBeenCalledWith('id', 'user-2');
    expect(supabase.spies.getUserById).toHaveBeenCalledWith('user-2');
    expect(supabase.spies.updateUserById).toHaveBeenCalledWith('user-2', {
      app_metadata: {
        locale: 'fr-CA',
        account_type: 'premium'
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({
      ok: true,
      updatedBy: 'admin-1',
      userId: 'user-2',
      accountTypeId: 'premium'
    });
  });

  it('returns 500 when profile update fails', async () => {
    const supabase = buildSupabaseMock({ profileUpdateError: { message: 'profile update failed' } });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-account-type');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer admin-token' },
      body: { userId: 'user-2', accountTypeId: 'premium' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_ERROR');
    expect(res.payload.error.message).toBe('profile update failed');
    expect(supabase.spies.updateUserById).not.toHaveBeenCalled();
  });

  it('returns 500 when metadata update fails', async () => {
    const supabase = buildSupabaseMock({ metadataUpdateError: { message: 'metadata update failed' } });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-account-type');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer admin-token' },
      body: { userId: 'user-2', accountTypeId: 'premium' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_ERROR');
    expect(res.payload.error.message).toBe('metadata update failed');
  });
});
