const { createReqRes } = require('./testHelpers');

function buildSupabaseMock({ rows, user, missingIdText = false, profileAccountType = null } = {}) {
  const adminUser = user ?? { id: 'admin-1', app_metadata: { role: 'admin', account_type: 'admin' } };
  const dataset = rows ?? [
    {
      id: 'user-1',
      id_text: 'user-1',
      email: 'alpha@example.com',
      auth_created_at: '2026-03-20T00:00:00Z',
      tier: 'free',
      messages_this_month: 1,
      total_events: 1
    },
    {
      id: 'user-2',
      id_text: 'user-2',
      email: 'bravo@example.com',
      auth_created_at: '2026-03-20T00:00:00Z',
      tier: 'premium',
      messages_this_month: 2,
      total_events: 2
    },
    {
      id: 'user-3',
      id_text: 'user-3',
      email: 'target@example.com',
      auth_created_at: '2026-03-21T00:00:00Z',
      tier: 'premium',
      messages_this_month: 3,
      total_events: 3
    }
  ];

  const getUser = jest.fn().mockResolvedValue({
    data: { user: adminUser },
    error: adminUser ? null : { message: 'invalid jwt' }
  });
  const profileMaybeSingle = jest.fn().mockResolvedValue({
    data: typeof profileAccountType === 'string' ? { account_type_id: profileAccountType } : null,
    error: null
  });

  const from = jest.fn((table) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: profileMaybeSingle
          })
        })
      };
    }

    if (table !== 'admin_user_list') {
      throw new Error(`Unexpected table: ${table}`);
    }

    const state = {
      tier: null,
      search: null,
      selectedColumns: ''
    };

    const query = {
      eq: (column, value) => {
        expect(column).toBe('tier');
        state.tier = value;
        return query;
      },
      or: (value) => {
        state.search = value;
        return query;
      },
      order: () => query,
      range: (start, end) => {
        if (missingIdText && typeof state.selectedColumns === 'string' && state.selectedColumns.includes('id_text')) {
          return Promise.resolve({
            data: null,
            error: {
              code: '42703',
              message: 'column admin_user_list.id_text does not exist'
            },
            count: null
          });
        }

        let filtered = [...dataset];
        if (state.tier) {
          filtered = filtered.filter((row) => row.tier === state.tier);
        }

        if (state.search) {
          const match = state.search.match(/email\.ilike\.%([^%]+)%/i);
          const searchTerm = match && typeof match[1] === 'string' ? match[1].toLowerCase() : '';
          const idEqMatch = state.search.match(/id\.eq\.([^,]+)/i);
          const idEqTerm = idEqMatch && typeof idEqMatch[1] === 'string' ? idEqMatch[1].toLowerCase() : '';
          if (searchTerm) {
            filtered = filtered.filter(
              (row) =>
                (typeof row.email === 'string' && row.email.toLowerCase().includes(searchTerm)) ||
                row.id_text.toLowerCase().includes(searchTerm) ||
                (idEqTerm && row.id.toLowerCase() === idEqTerm)
            );
          } else if (idEqTerm) {
            filtered = filtered.filter((row) => row.id.toLowerCase() === idEqTerm);
          }
        }

        filtered.sort((left, right) => Date.parse(right.auth_created_at) - Date.parse(left.auth_created_at));
        return Promise.resolve({
          data: filtered.slice(start, end + 1),
          error: null,
          count: filtered.length
        });
      }
    };

    return {
      select: (columns) => {
        state.selectedColumns = columns;
        return query;
      }
    };
  });

  return {
    client: {
      auth: {
        getUser
      },
      from
    },
    spies: { getUser, from, profileMaybeSingle }
  };
}

describe('api/admin-users', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    CLAUDE_MONTHLY_CAP_REGULAR: process.env.CLAUDE_MONTHLY_CAP_REGULAR
  };

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.CLAUDE_MONTHLY_CAP_REGULAR;
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

    if (typeof originalEnv.CLAUDE_MONTHLY_CAP_REGULAR === 'string') {
      process.env.CLAUDE_MONTHLY_CAP_REGULAR = originalEnv.CLAUDE_MONTHLY_CAP_REGULAR;
    } else {
      delete process.env.CLAUDE_MONTHLY_CAP_REGULAR;
    }
  });

  it('returns 401 when bearer token is missing', async () => {
    const supabase = buildSupabaseMock();
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    process.env.ALLOWED_ORIGINS = 'https://admin.example.com';

    const handler = require('../admin-users');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { origin: 'https://admin.example.com' }
    });
    req.query = { page: '0', limit: '25' };

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 for authenticated non-admin users', async () => {
    const supabase = buildSupabaseMock({
      user: { id: 'user-1', app_metadata: { role: 'user', account_type: 'regular' } }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-users');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { authorization: 'Bearer user-token' }
    });
    req.query = { page: '0', limit: '25' };

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.payload.error.code).toBe('FORBIDDEN');
  });

  it('allows access when JWT metadata is stale but profile tier is admin', async () => {
    const supabase = buildSupabaseMock({
      user: { id: 'admin-2', app_metadata: { role: 'user', account_type: 'regular' } },
      profileAccountType: 'admin'
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-users');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { authorization: 'Bearer stale-admin-token' }
    });
    req.query = { page: '0', limit: '25' };

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.users).toHaveLength(3);
    expect(supabase.spies.profileMaybeSingle).toHaveBeenCalled();
  });

  it('filters by search server-side and returns matching users', async () => {
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
    expect(supabase.spies.from).toHaveBeenCalledWith('admin_user_list');
  });

  it('applies tier filtering with pagination and keeps total count', async () => {
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
    expect(res.payload.users[0].tier).toBe('premium');
    expect(res.payload.total).toBe(2);
    expect(res.payload.page).toBe(0);
    expect(res.payload.limit).toBe(1);
  });

  it('falls back when admin_user_list.id_text is missing', async () => {
    const supabase = buildSupabaseMock({ missingIdText: true });
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
      email: 'target@example.com'
    });
  });

  it('returns effectiveCap and remainingCredits for non-admin users', async () => {
    process.env.CLAUDE_MONTHLY_CAP_REGULAR = '100';
    const supabase = buildSupabaseMock({
      rows: [
        {
          id: 'regular-1',
          id_text: 'regular-1',
          email: 'regular@example.com',
          auth_created_at: '2026-03-20T00:00:00Z',
          tier: 'regular',
          messages_this_month: 30,
          monthly_cap_override: null,
          total_events: 7
        }
      ]
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-users');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { authorization: 'Bearer admin-token' }
    });
    req.query = { page: '0', limit: '25' };

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.users[0]).toMatchObject({
      id: 'regular-1',
      effectiveCap: 100,
      remainingCredits: 70
    });
  });

  it('returns unlimited remaining credits for admin tier users', async () => {
    const supabase = buildSupabaseMock({
      rows: [
        {
          id: 'admin-2',
          id_text: 'admin-2',
          email: 'admin2@example.com',
          auth_created_at: '2026-03-20T00:00:00Z',
          tier: 'admin',
          messages_this_month: 999,
          monthly_cap_override: null,
          total_events: 999
        }
      ]
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));

    const handler = require('../admin-users');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { authorization: 'Bearer admin-token' }
    });
    req.query = { page: '0', limit: '25' };

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.users[0]).toMatchObject({
      id: 'admin-2',
      effectiveCap: null,
      remainingCredits: null
    });
  });
});
