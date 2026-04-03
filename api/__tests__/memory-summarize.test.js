const { createReqRes } = require('./testHelpers');

function buildSupabaseClient({
  user = { id: 'user-1' },
  authError = null,
  upsertData = null,
  upsertError = null
} = {}) {
  const upsertMaybeSingle = jest.fn().mockResolvedValue({
    data: upsertData,
    error: upsertError
  });
  const upsertSelect = jest.fn(() => ({
    maybeSingle: upsertMaybeSingle
  }));
  const upsert = jest.fn(() => ({
    select: upsertSelect
  }));

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user },
        error: authError
      })
    },
    from: jest.fn((table) => {
      if (table === 'relationship_memories') {
        return {
          upsert
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    })
  };
}

describe('api/memory-summarize', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    delete process.env.ALLOWED_ORIGINS;
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
    if (typeof originalEnv.ANTHROPIC_API_KEY === 'string') {
      process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
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

    const handler = require('../memory-summarize');
    const { req, res } = createReqRes({
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000'
      },
      body: {
        artistId: 'cathy-gauthier',
        excerptMessages: [{ role: 'user', content: 'Je vis a Montreal.' }]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload.error.code).toBe('UNAUTHORIZED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 when excerptMessages is missing', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../memory-summarize');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer token' },
      body: {
        artistId: 'cathy-gauthier'
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
  });

  it('summarizes memory and upserts relationship_memories', async () => {
    const supabaseClient = buildSupabaseClient({
      upsertData: {
        artist_id: 'cathy-gauthier',
        summary: 'Tu vis a Montreal et tu preferes les reponses directes.',
        key_facts: ['Tu vis a Montreal', 'Tu preferes les reponses directes'],
        source_user_turn_count: 24,
        updated_at: '2026-04-03T12:00:00.000Z'
      }
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabaseClient)
    }));

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary: 'Tu vis a Montreal et tu preferes les reponses directes.',
              keyFacts: ['Tu vis a Montreal', 'Tu preferes les reponses directes']
            })
          }
        ]
      })
    });

    const handler = require('../memory-summarize');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer token' },
      body: {
        artistId: 'cathy-gauthier',
        language: 'fr-CA',
        currentSummary: '',
        currentKeyFacts: [],
        sourceUserTurnCount: 24,
        excerptMessages: [
          { role: 'user', content: 'Je vis a Montreal.' },
          { role: 'assistant', content: 'Parfait, je retiens ca.' },
          { role: 'user', content: 'Je veux du concret, pas des reponses vagues.' }
        ]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.memory.summary).toBe('Tu vis a Montreal et tu preferes les reponses directes.');
    expect(res.payload.memory.keyFacts).toEqual([
      'Tu vis a Montreal',
      'Tu preferes les reponses directes'
    ]);

    const upsertMock = supabaseClient.from('relationship_memories').upsert;
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        artist_id: 'cathy-gauthier',
        source_user_turn_count: 24
      }),
      { onConflict: 'user_id,artist_id' }
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
