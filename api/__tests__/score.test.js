const { createReqRes } = require('./testHelpers');

function buildSupabaseClient({
  user = { id: 'user-1' },
  profile = {
    score: 0,
    roasts_generated: 0,
    punchlines_created: 0,
    destructions: 0,
    photos_roasted: 0,
    memes_generated: 0,
    battle_wins: 0,
    daily_streak: 0,
    last_active_date: null
  },
  rpcData = null,
  rpcError = null
} = {}) {
  let profileRow = { ...profile };

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: 'invalid jwt' }
      })
    },
    rpc: jest.fn().mockResolvedValue({
      data: rpcData,
      error: rpcError
    }),
    from: jest.fn((table) => {
      if (table !== 'profiles') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select: () => ({
          eq: () => ({
            maybeSingle: jest.fn().mockResolvedValue({
              data: profileRow,
              error: null
            })
          })
        }),
        update: (patch) => ({
          eq: () => {
            profileRow = { ...profileRow, ...patch };
            return Promise.resolve({ error: null });
          }
        })
      };
    })
  };
}

describe('api/score', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
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
  });

  it('returns 401 when bearer token is missing', async () => {
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));
    const handler = require('../score');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { origin: 'https://app.example.com' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload.error.code).toBe('UNAUTHORIZED');
  });

  it('returns current stats on GET', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          profile: {
            score: 100,
            roasts_generated: 3,
            punchlines_created: 4,
            destructions: 1,
            photos_roasted: 2,
            memes_generated: 5,
            battle_wins: 1,
            daily_streak: 2,
            last_active_date: '2026-03-10'
          }
        })
      )
    }));
    const handler = require('../score');
    const { req, res } = createReqRes({
      method: 'GET',
      headers: { authorization: 'Bearer valid-token' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.score).toBe(100);
    expect(res.payload.roastsGenerated).toBe(3);
    expect(res.payload.lastActiveDate).toBe('2026-03-10');
  });

  it('returns 400 for invalid score action', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));
    const handler = require('../score');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: { action: 'nope' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
  });

  it('applies score action through RPC on POST', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          rpcData: [
            {
              score: 25,
              roasts_generated: 0,
              punchlines_created: 0,
              destructions: 1,
              photos_roasted: 0,
              memes_generated: 0,
              battle_wins: 1,
              daily_streak: 0,
              last_active_date: null
            }
          ]
        })
      )
    }));
    const handler = require('../score');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: { action: 'battle_win' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.score).toBe(25);
    expect(res.payload.battleWins).toBe(1);
    expect(res.payload.destructions).toBe(1);
  });

  it('falls back to profile update path when RPC is missing', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          profile: {
            score: 0,
            roasts_generated: 0,
            punchlines_created: 0,
            destructions: 0,
            photos_roasted: 0,
            memes_generated: 0,
            battle_wins: 0,
            daily_streak: 0,
            last_active_date: null
          },
          rpcError: { code: 'PGRST202', message: 'Could not find function apply_score_action' }
        })
      )
    }));
    const handler = require('../score');
    const { req, res } = createReqRes({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: { action: 'roast_generated' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.score).toBe(5);
    expect(res.payload.roastsGenerated).toBe(1);
  });
});
