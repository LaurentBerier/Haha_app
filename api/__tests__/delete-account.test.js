const { createReqRes } = require('./testHelpers');

describe('api/delete-account', () => {
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

  it('rejects requests without bearer token', async () => {
    const getUser = jest.fn();
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({
        auth: {
          getUser,
          admin: { deleteUser: jest.fn() }
        }
      }))
    }));
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';

    const handler = require('../delete-account');
    const { req, res } = createReqRes({
      headers: { origin: 'https://app.example.com' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload.error.code).toBe('UNAUTHORIZED');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('rejects invalid bearer token', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({
        auth: {
          getUser: jest.fn().mockResolvedValue({
            data: { user: null },
            error: { message: 'invalid jwt' }
          }),
          admin: { deleteUser: jest.fn() }
        }
      }))
    }));

    const handler = require('../delete-account');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer bad-token' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload.error.code).toBe('UNAUTHORIZED');
  });

  it('deletes user when token is valid', async () => {
    const deleteUser = jest.fn().mockResolvedValue({ error: null });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({
        auth: {
          getUser: jest.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null
          }),
          admin: { deleteUser }
        }
      }))
    }));

    const handler = require('../delete-account');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer good-token' }
    });

    await handler(req, res);

    expect(deleteUser).toHaveBeenCalledWith('user-123');
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, deletedUserId: 'user-123' });
  });

  it('returns 500 when Supabase delete fails', async () => {
    const deleteUser = jest.fn().mockResolvedValue({ error: { message: 'delete failed' } });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({
        auth: {
          getUser: jest.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null
          }),
          admin: { deleteUser }
        }
      }))
    }));

    const handler = require('../delete-account');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer good-token' }
    });

    await handler(req, res);

    expect(deleteUser).toHaveBeenCalledWith('user-123');
    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_ERROR');
    expect(res.payload.error.message).toBe('delete failed');
  });
});
