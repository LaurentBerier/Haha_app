const { createReqRes } = require('./testHelpers');

function buildSupabaseMock({ authPages, profileRows, user } = {}) {
  const adminUser = user ?? { id: 'admin-1', app_metadata: { role: 'admin', account_type: 'admin' } };
  const pages = authPages ?? [
    {
      users: [
        { id: 'user-1', email: 'alpha@example.com', created_at: '2026-03-20T00:00:00Z' },
        { id: 'user-2', email: 'bravo@example.com', created_at: '2026-03-20T00:00:00Z' }
      ],
      total: 3
    },
    {
      users: [
        { id: 'user-3', email: 'target@example.com', created_at: '2026-03-20T00:00:00Z' }
      ],
      total: 3
    }
  ];
  const rows = profileRows ?? [
    { id: 'user-1', tier: 'free', messages_this_month: 1, total_events: 1 },
    { id: 'user-2', tier: 'free', messages_this_month: 2, total_events: 2 },
    { id: 'user-3', tier: 'premium', messages_this_month: 3, total_events: 3 }
  ];

  const getUser = jest.fn().mockResolvedValue({
    data: { user: adminUser },
    error: adminUser ? null : { message: 'invalid jwt' }
  });
  const listUsers = jest.fn().mockImplementation(({ page }) =>
    Promise.resolve({
      data: pages[page - 1] ?? { users: [], total: pages.reduce((sum, entry) => sum + entry.users.length, 0) },
      error: null
    })
  );

  const from = jest.fn((table) => {
    if (table !== 'admin_user_list') {
      throw new Error(`Unexpected table: ${table}`);
    }

    const state = { ids: null, tier: null };
    return {
      select: () => ({
        in: (column, ids) => {
          expect(column).toBe('id');
          state.ids = ids;
          return {
            eq: (eqColumn, value) => {
              expect(eqColumn).toBe('tier');
              state.tier = value;
              return Promise.resolve({
                data: rows.filter((row) => state.ids.includes(row.id) && row.tier === state.tier),
                error: null
              });
            },
            then(resolve, reject) {
              return Promise.resolve({
                data: rows.filter((row) => state.ids.includes(row.id)),
                error: null
              }).then(resolve, reject);
            }
          };
        }
      })
    };
  });

  return {
    client: {
      auth: {
        getUser,
        admin: {
          listUsers
        }
      },
      from
    },
    spies: { getUser, listUsers, from }
  };
}

describe('api/admin-users', () => {
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

  it('searches across all auth pages before paginating', async () => {
    const supabase = buildSupabaseMock();
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-users');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { authorization: 'Bearer admin-token' }
    });
    req.query = { page: '0', limit: '25', search: 'target@example.com' };

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.users).toHaveLength(1);
    expect(res.payload.users[0]).toMatchObject({
      id: 'user-3',
      email: 'target@example.com',
      tier: 'premium'
    });
    expect(res.payload.total).toBe(1);
    expect(supabase.spies.listUsers).toHaveBeenCalledTimes(2);
  });

  it('applies tier filtering before pagination and reports filtered totals', async () => {
    const supabase = buildSupabaseMock();
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-users');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { authorization: 'Bearer admin-token' }
    });
    req.query = { page: '0', limit: '1', tier: 'premium' };

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.users).toHaveLength(1);
    expect(res.payload.users[0].id).toBe('user-3');
    expect(res.payload.total).toBe(1);
    expect(res.payload.page).toBe(0);
    expect(res.payload.limit).toBe(1);
  });
});
