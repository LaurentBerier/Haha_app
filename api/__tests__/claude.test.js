const { createReqRes } = require('./testHelpers');

function buildSupabaseClient({
  user = { id: 'user-1', app_metadata: {} },
  profile = null,
  initialUsageCount = 0,
  usageCountError = null,
  usageInsertError = null,
  usageInsertErrors = null,
  profileSelectError = null,
  profilePreferredNameColumnMissing = false,
  rpcResult = null,
  rpcError = null
} = {}) {
  let usageCount = initialUsageCount;
  let profileRow = profile;
  const usageSelect = jest.fn().mockImplementation(() => ({
    eq: jest.fn().mockImplementation(() => ({
      eq: jest.fn().mockImplementation(() => ({
        gte: jest.fn().mockResolvedValue({
          count: usageCount,
          error: usageCountError
        })
      }))
    }))
  }));
  const usageInsert = jest.fn().mockImplementation(() => {
    let currentInsertError = usageInsertError;
    if (Array.isArray(usageInsertErrors) && usageInsertErrors.length > 0) {
      currentInsertError = usageInsertErrors.shift();
    }

    if (!currentInsertError) {
      usageCount += 1;
    }
    return Promise.resolve({ error: currentInsertError });
  });
  const profileMaybeSingle = jest.fn().mockImplementation((selectedColumns = '') => {
    const columns = typeof selectedColumns === 'string' ? selectedColumns : '';
    if (profilePreferredNameColumnMissing && columns.includes('preferred_name')) {
      return Promise.resolve({
        data: null,
        error: { code: '42703', message: 'column "preferred_name" does not exist' }
      });
    }

    return Promise.resolve({
      data: profileRow,
      error: profileSelectError
    });
  });
  const profileUpdateEq = jest.fn().mockResolvedValue({ error: null });
  const rpc = jest.fn().mockResolvedValue({
    data: rpcResult,
    error: rpcError
  });

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: 'invalid jwt' }
      })
    },
    rpc,
    from: jest.fn((table) => {
      if (table === 'usage_events') {
        return {
          select: usageSelect,
          insert: usageInsert
        };
      }

      if (table === 'profiles') {
        return {
          select: (selectedColumns) => ({
            eq: () => ({
              maybeSingle: () => profileMaybeSingle(selectedColumns)
            })
          }),
          update: (updates) => ({
            eq: (column, value) => {
              if (column === 'id' && typeof value === 'string') {
                profileRow =
                  profileRow && typeof profileRow === 'object'
                    ? { ...profileRow, ...updates }
                    : { ...updates };
              }

              return profileUpdateEq();
            }
          })
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    })
  };
}

describe('api/claude', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    CLAUDE_RATE_LIMIT_MAX_REQUESTS: process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS,
    CLAUDE_RATE_LIMIT_WINDOW_MS: process.env.CLAUDE_RATE_LIMIT_WINDOW_MS,
    CLAUDE_IP_RATE_LIMIT_MAX_REQUESTS: process.env.CLAUDE_IP_RATE_LIMIT_MAX_REQUESTS,
    CLAUDE_IP_RATE_LIMIT_WINDOW_MS: process.env.CLAUDE_IP_RATE_LIMIT_WINDOW_MS,
    CLAUDE_MONTHLY_CAP_FREE: process.env.CLAUDE_MONTHLY_CAP_FREE,
    CLAUDE_LIMITS_RPC: process.env.CLAUDE_LIMITS_RPC,
    KV_URL: process.env.KV_URL,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    NODE_ENV: process.env.NODE_ENV
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-api-key';
    process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = '30';
    delete process.env.CLAUDE_RATE_LIMIT_WINDOW_MS;
    delete process.env.CLAUDE_IP_RATE_LIMIT_MAX_REQUESTS;
    delete process.env.CLAUDE_IP_RATE_LIMIT_WINDOW_MS;
    delete process.env.CLAUDE_MONTHLY_CAP_FREE;
    delete process.env.CLAUDE_LIMITS_RPC;
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.KV_URL;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.NODE_ENV = 'test';
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

    if (typeof originalEnv.CLAUDE_RATE_LIMIT_MAX_REQUESTS === 'string') {
      process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = originalEnv.CLAUDE_RATE_LIMIT_MAX_REQUESTS;
    } else {
      delete process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS;
    }

    if (typeof originalEnv.CLAUDE_RATE_LIMIT_WINDOW_MS === 'string') {
      process.env.CLAUDE_RATE_LIMIT_WINDOW_MS = originalEnv.CLAUDE_RATE_LIMIT_WINDOW_MS;
    } else {
      delete process.env.CLAUDE_RATE_LIMIT_WINDOW_MS;
    }

    if (typeof originalEnv.CLAUDE_IP_RATE_LIMIT_MAX_REQUESTS === 'string') {
      process.env.CLAUDE_IP_RATE_LIMIT_MAX_REQUESTS = originalEnv.CLAUDE_IP_RATE_LIMIT_MAX_REQUESTS;
    } else {
      delete process.env.CLAUDE_IP_RATE_LIMIT_MAX_REQUESTS;
    }

    if (typeof originalEnv.CLAUDE_IP_RATE_LIMIT_WINDOW_MS === 'string') {
      process.env.CLAUDE_IP_RATE_LIMIT_WINDOW_MS = originalEnv.CLAUDE_IP_RATE_LIMIT_WINDOW_MS;
    } else {
      delete process.env.CLAUDE_IP_RATE_LIMIT_WINDOW_MS;
    }

    if (typeof originalEnv.CLAUDE_MONTHLY_CAP_FREE === 'string') {
      process.env.CLAUDE_MONTHLY_CAP_FREE = originalEnv.CLAUDE_MONTHLY_CAP_FREE;
    } else {
      delete process.env.CLAUDE_MONTHLY_CAP_FREE;
    }

    if (typeof originalEnv.CLAUDE_LIMITS_RPC === 'string') {
      process.env.CLAUDE_LIMITS_RPC = originalEnv.CLAUDE_LIMITS_RPC;
    } else {
      delete process.env.CLAUDE_LIMITS_RPC;
    }

    if (typeof originalEnv.KV_URL === 'string') {
      process.env.KV_URL = originalEnv.KV_URL;
    } else {
      delete process.env.KV_URL;
    }

    if (typeof originalEnv.KV_REST_API_URL === 'string') {
      process.env.KV_REST_API_URL = originalEnv.KV_REST_API_URL;
    } else {
      delete process.env.KV_REST_API_URL;
    }

    if (typeof originalEnv.KV_REST_API_TOKEN === 'string') {
      process.env.KV_REST_API_TOKEN = originalEnv.KV_REST_API_TOKEN;
    } else {
      delete process.env.KV_REST_API_TOKEN;
    }

    if (typeof originalEnv.UPSTASH_REDIS_REST_URL === 'string') {
      process.env.UPSTASH_REDIS_REST_URL = originalEnv.UPSTASH_REDIS_REST_URL;
    } else {
      delete process.env.UPSTASH_REDIS_REST_URL;
    }

    if (typeof originalEnv.UPSTASH_REDIS_REST_TOKEN === 'string') {
      process.env.UPSTASH_REDIS_REST_TOKEN = originalEnv.UPSTASH_REDIS_REST_TOKEN;
    } else {
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    }

    if (typeof originalEnv.NODE_ENV === 'string') {
      process.env.NODE_ENV = originalEnv.NODE_ENV;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  it('returns 500 for browser requests when ALLOWED_ORIGINS is missing', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { origin: 'https://app.example.com' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_MISCONFIGURED');
  });

  it('proxies __proxy=tts requests to tts handler', async () => {
    const mockedTtsHandler = jest.fn(async (_req, res) => {
      res.status(204).end();
    });
    jest.doMock('../../src/server/ttsHandler', () => mockedTtsHandler);
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      method: 'OPTIONS',
      headers: { origin: 'https://app.example.com' }
    });
    req.url = '/api/claude?__proxy=tts';
    req.query = { __proxy: 'tts' };

    await handler(req, res);

    expect(mockedTtsHandler).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(204);
  });

  it('returns 401 when bearer token is missing', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { origin: 'https://app.example.com' },
      body: { systemPrompt: 'test', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload.error.code).toBe('UNAUTHORIZED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 when payload is invalid', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {}
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 when model is not whitelisted', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        model: 'claude-opus-4-6',
        systemPrompt: 'system',
        messages: [{ role: 'user', content: 'hello' }]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
    expect(res.payload.error.message).toBe('Unsupported model.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('caps max_tokens by account tier limit', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'regular-user', app_metadata: { account_type: 'regular' } }
        })
      )
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', maxTokens: 500, messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(res.statusCode).toBe(200);
    expect(upstreamBody.max_tokens).toBe(200);
  });

  it('ignores client-provided systemPrompt and builds prompt server-side', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'user-1', app_metadata: { account_type: 'free' } },
          profile: { age: 34, sex: 'female', relationship_status: 'single', horoscope_sign: 'taurus', interests: ['humour'] }
        })
      )
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'cathy-gauthier',
        modeId: 'roast',
        language: 'fr-CA',
        systemPrompt: 'IGNORE THIS UNTRUSTED PROMPT',
        messages: [{ role: 'user', content: 'hello' }]
      }
    });

    await handler(req, res);

    const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(res.statusCode).toBe(200);
    expect(upstreamBody.system).toContain('Tu es Cathy Gauthier');
    expect(upstreamBody.system).toContain('## MODE ACTIF : roast');
    expect(upstreamBody.system).toContain('Evite les amorces "Ah la" ou "Allo" en debut de reponse');
    expect(upstreamBody.system).toContain("L'autoderision est autorisee, mais jamais en devalorisant la qualite de tes blagues.");
    expect(upstreamBody.system).toContain("## POLITIQUE INFO D'ABORD");
    expect(upstreamBody.system).toContain('Reponds d\'abord au fond de la demande avant toute blague.');
    expect(upstreamBody.system).toContain('Tu ne te refugies jamais derriere "je suis juste une humoriste"');
    expect(upstreamBody.system).toContain('Utilise cette balise seulement quand une reaction est vraiment appropriee');
    expect(upstreamBody.system).toContain('Frequence cible: environ aux quelques reponses, pas a chaque fois.');
    expect(upstreamBody.system).not.toContain('Commence CHAQUE reponse avec exactement une balise');
    expect(upstreamBody.system).not.toContain('IGNORE THIS UNTRUSTED PROMPT');
  });

  it('builds on-jase prompt with the new "Dis-moi la verite" framing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_truth', content: [{ type: 'text', text: 'ok' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'cathy-gauthier',
        modeId: 'on-jase',
        language: 'fr-CA',
        messages: [{ role: 'user', content: 'Dis-moi la vraie affaire.' }]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(upstreamBody.system).toContain('Ce mode s\'appelle "Dis-moi la verite"');
    expect(upstreamBody.system).toContain('Pas en mode roast');
  });

  it('builds screenshot-analyzer prompt for screenshot and pasted text judgment', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_texto', content: [{ type: 'text', text: 'ok' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'cathy-gauthier',
        modeId: 'screenshot-analyzer',
        language: 'fr-CA',
        imageIntent: 'screenshot-analyzer',
        messages: [{ role: 'user', content: 'Lis ce screenshot stp.' }]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(upstreamBody.system).toContain('Mode "Jugement de Texto"');
    expect(upstreamBody.system).toContain("capture d'ecran OU coller un echange texte");
    expect(upstreamBody.system).toContain('CONTEXTE IMAGE');
    expect(upstreamBody.system).toContain('Lis le screenshot comme un texto');
  });

  it('injects available experiences section with discrete suggestion rules for Cathy', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_exp', content: [{ type: 'text', text: 'ok' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'cathy-gauthier',
        modeId: 'on-jase',
        language: 'fr-CA',
        availableExperiences: [
          {
            id: 'on-jase',
            type: 'mode',
            name: 'Dis-moi la verite',
            aliases: ['dis moi la verite'],
            ctaExamples: ['Lance le mode Dis-moi la verite']
          },
          {
            id: 'impro-chain',
            type: 'game',
            name: 'Impro',
            aliases: ['impro'],
            ctaExamples: ['Lance le jeu Impro']
          }
        ],
        messages: [{ role: 'user', content: 'Je veux un truc fun.' }]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(upstreamBody.system).toContain('## MODES ET JEUX DISPONIBLES');
    expect(upstreamBody.system).toContain('Mode: Dis-moi la verite');
    expect(upstreamBody.system).toContain('Jeu: Impro');
    expect(upstreamBody.system).toContain('Suggere au maximum UNE experience par reponse');
    expect(upstreamBody.system).toContain('Dis: "lance <nom de l\'experience>"');
  });

  it('sanitizes available experiences and ignores invalid entries', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_exp_clean', content: [{ type: 'text', text: 'ok' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'cathy-gauthier',
        modeId: 'on-jase',
        language: 'fr-CA',
        availableExperiences: [
          {
            id: 'invalid-entry',
            type: 'unknown',
            name: 'Should be ignored'
          },
          {
            id: 'screenshot-analyzer',
            type: 'mode',
            name: 'Jugement de Texto',
            aliases: ['jugement de texto'],
            ctaExamples: ['Lance le mode Jugement de Texto']
          }
        ],
        messages: [{ role: 'user', content: 'Salut' }]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(upstreamBody.system).toContain('Mode: Jugement de Texto');
    expect(upstreamBody.system).not.toContain('Should be ignored');
  });

  it('builds an English system prompt without French-only constraints for en-* language', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_en', content: [{ type: 'text', text: 'hello' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'cathy-gauthier',
        modeId: 'on-jase',
        language: 'en-CA',
        messages: [{ role: 'user', content: 'Talk in English please' }]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(upstreamBody.system).toContain('You are Cathy Gauthier');
    expect(upstreamBody.system).toContain('- Respond in English.');
    expect(upstreamBody.system).toContain('## INFORMATION-FIRST POLICY');
    expect(upstreamBody.system).toContain('Never dodge informational questions with "I am just a comedian"');
    expect(upstreamBody.system).not.toContain('Tu reponds toujours en francais quebecois');
    expect(upstreamBody.system).not.toContain('Registre : francais quebecois familier');
  });

  it('builds an intl prompt that enforces context.language without French-only constraints', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_intl', content: [{ type: 'text', text: 'hola' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'cathy-gauthier',
        modeId: 'on-jase',
        language: 'es-ES',
        messages: [{ role: 'user', content: 'Habla en espanol por favor' }]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(upstreamBody.system).toContain('You are Cathy Gauthier');
    expect(upstreamBody.system).toContain('Respond in the active conversation language (es-ES)');
    expect(upstreamBody.system).toContain('## INFORMATION-FIRST POLICY');
    expect(upstreamBody.system).toContain('Never dodge informational questions with "I am just a comedian"');
    expect(upstreamBody.system).not.toContain('Tu reponds toujours en francais quebecois');
    expect(upstreamBody.system).not.toContain('Registre : francais quebecois familier');
  });

  it('disables current-context injection when tutorialMode is enabled', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'user-1', app_metadata: { account_type: 'free' } }
        })
      )
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'cathy-gauthier',
        modeId: 'on-jase',
        language: 'fr-CA',
        tutorialMode: true,
        messages: [{ role: 'user', content: 'Salut' }]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(upstreamBody.system).toContain("Mode tutorial : n'introduis pas meteo ni actualite");
    expect(upstreamBody.system).not.toContain('## CONTEXTE ACTUEL');
    expect(upstreamBody.system).not.toContain('## CURRENT CONTEXT');
    expect(upstreamBody.system).not.toContain('## REPONSE INFO OBLIGATOIRE');
    expect(upstreamBody.system).not.toContain('## MANDATORY CURRENT-INFO RESPONSE');
  });

  it('injects context + mandatory answer instruction in tutorial mode for vague weather/news requests', async () => {
    process.env.NODE_ENV = 'development';
    global.fetch = jest.fn((input) => {
      const url = String(input ?? '');
      if (url.startsWith('https://api.open-meteo.com/')) {
        return Promise.resolve({
          ok: true,
          json: jest.fn().mockResolvedValue({
            current: {
              temperature_2m: 6,
              weather_code: 3
            }
          })
        });
      }
      if (url.includes('rss')) {
        return Promise.resolve({
          ok: true,
          text: jest.fn().mockResolvedValue(
            '<rss><channel><item><title>Manchette locale test</title></item></channel></rss>'
          )
        });
      }

      return Promise.resolve({
        ok: true,
        json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
      });
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'user-1', app_metadata: { account_type: 'free' } }
        })
      )
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'cathy-gauthier',
        modeId: 'on-jase',
        language: 'fr-CA',
        tutorialMode: true,
        coords: { lat: 45.5017, lon: -73.5673 },
        messages: [{ role: 'user', content: 'La meteo et les nouvelles stp?' }]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const upstreamFetchCall = global.fetch.mock.calls.find((call) => String(call?.[0] ?? '').includes('/v1/messages'));
    expect(upstreamFetchCall).toBeTruthy();
    const upstreamBody = JSON.parse(upstreamFetchCall[1].body);
    expect(upstreamBody.system).toContain("Mode tutorial : n'introduis pas meteo ni actualite");
    expect(upstreamBody.system).toContain('## CONTEXTE ACTUEL');
    expect(upstreamBody.system).toContain('Meteo:');
    expect(upstreamBody.system).toContain('Manchettes:');
    expect(upstreamBody.system).toContain('## REPONSE INFO OBLIGATOIRE');
    expect(upstreamBody.system).toContain("Si une info demandee est indisponible, dis-le explicitement.");
  });

  it('keeps user name context from auth metadata when profiles.preferred_name column is missing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'user-1', app_metadata: { account_type: 'free' }, user_metadata: { display_name: 'Laurent' } },
          profile: {
            age: 34,
            sex: 'male',
            relationship_status: 'single',
            horoscope_sign: 'aries',
            interests: ['humour']
          },
          profilePreferredNameColumnMissing: true
        })
      )
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'cathy-gauthier',
        modeId: 'on-jase',
        language: 'fr-CA',
        messages: [{ role: 'user', content: 'Qu est ce que tu sais de moi?' }]
      }
    });

    await handler(req, res);

    const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(res.statusCode).toBe(200);
    expect(upstreamBody.system).toContain('Prenom prefere a utiliser: <user_value>Laurent</user_value>');
    expect(upstreamBody.system).toContain('Signe astro : Belier');
    expect(upstreamBody.system).toContain("n'affirme jamais que tu ne sais rien");
  });

  it('caps each user interest to 50 chars before injecting prompt context', async () => {
    const veryLongInterest = 'a'.repeat(120);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'ok' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'user-1', app_metadata: { account_type: 'free' } },
          profile: {
            age: 34,
            sex: 'female',
            relationship_status: 'single',
            horoscope_sign: 'aries',
            interests: [veryLongInterest]
          }
        })
      )
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'cathy-gauthier',
        modeId: 'on-jase',
        language: 'fr-CA',
        messages: [{ role: 'user', content: 'Salut' }]
      }
    });

    await handler(req, res);

    const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(res.statusCode).toBe(200);
    expect(upstreamBody.system).toContain(`Interets : <user_value>${'a'.repeat(50)}`);
    expect(upstreamBody.system).not.toContain('a'.repeat(51));
  });

  it('clamps oversized server system prompts instead of returning 400', async () => {
    const oversizedExperiences = Array.from({ length: 20 }, (_, index) => ({
      id: `exp-${index}`,
      type: 'mode',
      name: `Experience ${index} ${'x'.repeat(120)}`,
      ctaExamples: [`lance ${index} ${'y'.repeat(200)}`]
    }));

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'ok' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'user-1', app_metadata: { account_type: 'free' } },
          profile: {
            preferred_name: 'Laurent',
            age: 34,
            sex: 'male',
            relationship_status: 'in_relationship',
            horoscope_sign: 'aries',
            interests: Array.from({ length: 12 }, (_, idx) => `interet-${idx}-${'z'.repeat(80)}`)
          }
        })
      )
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'cathy-gauthier',
        modeId: 'on-jase',
        language: 'fr-CA',
        availableExperiences: oversizedExperiences,
        messages: [
          {
            role: 'user',
            content:
              'Je travaille de nuit. Je vis a Montreal. Je prefere l humour noir. Je joue au hockey. Je suis sagittaire. Je veux monter mes standards.'
          }
        ]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const upstreamFetchCall = global.fetch.mock.calls.find((call) => String(call?.[0] ?? '').includes('/v1/messages'));
    expect(upstreamFetchCall).toBeTruthy();
    const upstreamBody = JSON.parse(upstreamFetchCall[1].body);
    expect(upstreamBody.system.length).toBeLessThanOrEqual(12000);
    expect(upstreamBody.system).toContain('## MODE ACTIF : on-jase');
    expect(upstreamBody.system).toContain('## GUARDRAILS');
  });

  it('returns 400 for unsupported artist in prompt context', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: {
        artistId: 'unknown-artist',
        messages: [{ role: 'user', content: 'hello' }]
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
    expect(res.payload.error.message).toBe('Unsupported artist.');
  });

  it('forwards upstream non-ok errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: jest.fn().mockResolvedValue({ error: { message: 'Rate limited' } }),
      text: jest.fn().mockResolvedValue('rate limited')
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(429);
    expect(res.payload).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'UPSTREAM_ERROR',
          message: 'Rate limited'
        })
      })
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns 502 when upstream is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.payload.error.code).toBe('UPSTREAM_UNREACHABLE');
  });

  it('returns 504 when upstream request times out', async () => {
    const timeoutError = new Error('timed out');
    timeoutError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(timeoutError);

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(504);
    expect(res.payload.error.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('returns 429 when user exceeds rate limit', async () => {
    process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = '1';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const first = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });
    const second = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello again' }] }
    });

    await handler(first.req, first.res);
    await handler(second.req, second.res);

    expect(first.res.statusCode).toBe(200);
    expect(second.res.statusCode).toBe(429);
    expect(second.res.payload.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('enforces KV minute-bucket rate limiting when KV is configured', async () => {
    process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = '1';
    process.env.KV_REST_API_URL = 'https://kv.example.test';
    process.env.KV_REST_API_TOKEN = 'kv-token';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    const kvStore = new Map();
    jest.doMock('@vercel/kv', () => ({
      kv: {
        incr: jest.fn(async (key) => {
          const next = Number(kvStore.get(key) ?? 0) + 1;
          kvStore.set(key, next);
          return next;
        }),
        get: jest.fn(async (key) => (kvStore.has(key) ? kvStore.get(key) : null)),
        expire: jest.fn(async () => 1),
        set: jest.fn(async (key, value) => {
          kvStore.set(key, value);
          return 'OK';
        })
      }
    }));

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const first = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });
    const second = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello again' }] }
    });

    await handler(first.req, first.res);
    await handler(second.req, second.res);

    expect(first.res.statusCode).toBe(200);
    expect(second.res.statusCode).toBe(429);
    expect(second.res.payload.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('uses configured user rate-limit window for KV bucket keys', async () => {
    process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = '1';
    process.env.CLAUDE_RATE_LIMIT_WINDOW_MS = '120000';
    process.env.KV_REST_API_URL = 'https://kv.example.test';
    process.env.KV_REST_API_TOKEN = 'kv-token';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    const kvStore = new Map();
    const incrMock = jest.fn(async (key) => {
      const next = Number(kvStore.get(key) ?? 0) + 1;
      kvStore.set(key, next);
      return next;
    });
    const getMock = jest.fn(async (key) => (kvStore.has(key) ? kvStore.get(key) : null));
    const expireMock = jest.fn(async () => 1);
    const setMock = jest.fn(async (key, value) => {
      kvStore.set(key, value);
      return 'OK';
    });

    jest.doMock('@vercel/kv', () => ({
      kv: {
        incr: incrMock,
        get: getMock,
        expire: expireMock,
        set: setMock
      }
    }));

    jest.spyOn(Date, 'now').mockReturnValue(90_000);

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const first = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });
    const second = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello again' }] }
    });

    await handler(first.req, first.res);
    await handler(second.req, second.res);

    expect(first.res.statusCode).toBe(200);
    expect(second.res.statusCode).toBe(429);
    expect(second.res.payload.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(incrMock).toHaveBeenCalledWith('ratelimit:user-1:120000:0');
    expect(getMock).toHaveBeenCalledWith('ratelimit:user-1:120000:-1');
  });

  it('enforces per-IP rate limiting via KV when configured', async () => {
    process.env.CLAUDE_IP_RATE_LIMIT_MAX_REQUESTS = '1';
    process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = '100';
    process.env.KV_REST_API_URL = 'https://kv.example.test';
    process.env.KV_REST_API_TOKEN = 'kv-token';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    const kvStore = new Map();
    jest.doMock('@vercel/kv', () => ({
      kv: {
        incr: jest.fn(async (key) => {
          const next = Number(kvStore.get(key) ?? 0) + 1;
          kvStore.set(key, next);
          return next;
        }),
        get: jest.fn(async (key) => (kvStore.has(key) ? kvStore.get(key) : null)),
        expire: jest.fn(async () => 1),
        set: jest.fn(async (key, value) => {
          kvStore.set(key, value);
          return 'OK';
        })
      }
    }));

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const first = createReqRes({
      headers: { authorization: 'Bearer valid-token', 'x-forwarded-for': '198.51.100.22' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });
    const second = createReqRes({
      headers: { authorization: 'Bearer valid-token', 'x-forwarded-for': '198.51.100.22' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello again' }] }
    });

    await handler(first.req, first.res);
    await handler(second.req, second.res);

    expect(first.res.statusCode).toBe(200);
    expect(second.res.statusCode).toBe(429);
    expect(second.res.payload.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('fails closed in production when KV is not configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = '1';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_MISCONFIGURED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 500 when usage_events insert fails on missing request_id column', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    const currentMonthStartIso = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          profile: {
            monthly_message_count: 0,
            monthly_reset_at: currentMonthStartIso
          },
          usageInsertErrors: [{ code: '42703', message: 'column "request_id" does not exist' }, null]
        })
      )
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_MISCONFIGURED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 500 when usage_events rate-limit store is unavailable (no in-memory bypass)', async () => {
    process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = '1';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    const currentMonthStartIso = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          profile: {
            monthly_message_count: 0,
            monthly_reset_at: currentMonthStartIso
          },
          usageCountError: { code: '42P01', message: 'relation "usage_events" does not exist' }
        })
      )
    }));

    const handler = require('../claude');
    const first = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });
    const second = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello again' }] }
    });

    await handler(first.req, first.res);
    await handler(second.req, second.res);

    expect(first.res.statusCode).toBe(500);
    expect(first.res.payload.error.code).toBe('SERVER_MISCONFIGURED');
    expect(second.res.statusCode).toBe(500);
    expect(second.res.payload.error.code).toBe('SERVER_MISCONFIGURED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  describe('monthly quota enforcement', () => {
    function buildSuccessResponse() {
      return {
        ok: true,
        json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
      };
    }

    beforeEach(() => {
      process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = '100000';
      global.fetch = jest.fn().mockResolvedValue(buildSuccessResponse());
    });

    it('blocks free user once monthly cap is reached', async () => {
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'free-user', app_metadata: { account_type: 'free' } },
            initialUsageCount: 199
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer free-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(429);
      expect(res.headers['X-Quota-Mode']).toBe('blocked');
      expect(res.payload.error.code).toBe('QUOTA_EXCEEDED_BLOCKED');
      expect(global.fetch).toHaveBeenCalledTimes(0);
    });

    it('keeps normal mode for free user below soft cap', async () => {
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'free-user', app_metadata: { account_type: 'free' } },
            initialUsageCount: 30
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer free-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(res.statusCode).toBe(200);
      expect(res.headers['X-Quota-Mode']).toBe('normal');
      expect(upstreamBody.model).toBe('claude-sonnet-4-6');
      expect(upstreamBody.max_tokens).toBe(400);
    });

    it('uses soft1 mode for free user at 75 percent threshold', async () => {
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'free-user-soft1', app_metadata: { account_type: 'free' } },
            initialUsageCount: 149
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer free-soft1-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(res.statusCode).toBe(200);
      expect(res.headers['X-Quota-Mode']).toBe('soft1');
      expect(upstreamBody.model).toBe('claude-sonnet-4-6');
      expect(upstreamBody.max_tokens).toBe(360);
    });

    it('uses soft2 mode for free user at 90 percent threshold', async () => {
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'free-user-soft2', app_metadata: { account_type: 'free' } },
            initialUsageCount: 179
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer free-soft2-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(res.statusCode).toBe(200);
      expect(res.headers['X-Quota-Mode']).toBe('soft2');
      expect(upstreamBody.model).toBe('claude-haiku-4-5-20251001');
      expect(upstreamBody.max_tokens).toBe(280);
    });

    it('uses profile account type when auth metadata is stale', async () => {
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'stale-tier-user', app_metadata: { account_type: 'free' } },
            profile: { account_type_id: 'premium' },
            initialUsageCount: 500
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer stale-tier-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['X-Quota-Mode']).toBe('normal');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('uses soft1 mode for regular user at 75 percent threshold', async () => {
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'regular-user', app_metadata: { account_type: 'regular' } },
            initialUsageCount: 2249
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer regular-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(res.statusCode).toBe(200);
      expect(res.headers['X-Quota-Mode']).toBe('soft1');
      expect(upstreamBody.model).toBe('claude-sonnet-4-6');
      expect(upstreamBody.max_tokens).toBe(180);
    });

    it('uses economy mode for premium user at monthly cap', async () => {
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'premium-user', app_metadata: { account_type: 'premium' } },
            initialUsageCount: 24999
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer premium-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      const upstreamBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(res.statusCode).toBe(200);
      expect(res.headers['X-Quota-Mode']).toBe('economy');
      expect(upstreamBody.model).toBe('claude-haiku-4-5-20251001');
      expect(upstreamBody.max_tokens).toBe(100);
    });

    it('returns 200 for admin user with very high usage count', async () => {
      process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = '20000';
      global.fetch = jest.fn().mockResolvedValue(buildSuccessResponse());
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'admin-user', app_metadata: { account_type: 'admin' } },
            initialUsageCount: 9999
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer admin-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
    });

    it('treats role=admin as unlimited even when account_type is regular', async () => {
      process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS = '20000';
      global.fetch = jest.fn().mockResolvedValue(buildSuccessResponse());
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'role-admin-user', app_metadata: { role: 'admin', account_type: 'regular' } },
            initialUsageCount: 9999
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer role-admin-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['X-Quota-Mode']).not.toBe('blocked');
    });

    it('blocks when CLAUDE_MONTHLY_CAP_FREE override is reached', async () => {
      process.env.CLAUDE_MONTHLY_CAP_FREE = '3';
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'free-user', app_metadata: { account_type: 'free' } },
            initialUsageCount: 3
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer free-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(429);
      expect(res.headers['X-Quota-Mode']).toBe('blocked');
      expect(res.payload.error.code).toBe('QUOTA_EXCEEDED_BLOCKED');
      expect(global.fetch).toHaveBeenCalledTimes(0);
    });

    it('uses soft1 mode for unknown tier with free fallback cap at 75 percent+', async () => {
      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            user: { id: 'legacy-user', app_metadata: { account_type: 'legacy_plan' } },
            initialUsageCount: 149
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer legacy-token' },
        body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['X-Quota-Mode']).toBe('soft1');
    });
  });

  describe('limits rpc path', () => {
    it('accepts request when RPC path allows limits', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
      });
      process.env.CLAUDE_LIMITS_RPC = 'true';

      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            rpcResult: [{ allowed: true, status_code: 200, monthly_used: 1 }]
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer valid-token' },
        body: { systemPrompt: 'ignored', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('continues request when RPC reports monthly quota exceeded', async () => {
      process.env.CLAUDE_LIMITS_RPC = 'true';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
      });

      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            rpcResult: [
              {
                allowed: false,
                status_code: 429,
                error_code: 'MONTHLY_QUOTA_EXCEEDED',
                error_message: 'Monthly quota exceeded.',
                retry_after_seconds: 3600
              }
            ]
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer valid-token' },
        body: { systemPrompt: 'ignored', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['X-Quota-Mode']).toBe('normal');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to default path when RPC function is missing', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
      });
      process.env.CLAUDE_LIMITS_RPC = 'true';

      jest.doMock('@supabase/supabase-js', () => ({
        createClient: jest.fn(() =>
          buildSupabaseClient({
            rpcError: { code: 'PGRST202', message: 'Could not find function enforce_claude_limits' },
            initialUsageCount: 0
          })
        )
      }));

      const handler = require('../claude');
      const { req, res } = createReqRes({
        headers: { authorization: 'Bearer valid-token' },
        body: { systemPrompt: 'ignored', messages: [{ role: 'user', content: 'hello' }] }
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  it('returns 500 when usage_events table is unavailable', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient({ usageCountError: { message: 'missing table' } }))
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_MISCONFIGURED');
  });

  it('returns 502 when stream reader is unavailable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: undefined
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', stream: true, messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.payload.error.code).toBe('UPSTREAM_STREAM_MISSING');
  });

  it('returns 200 with upstream JSON payload for non-stream request', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] })
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ id: 'msg_1', content: [{ type: 'text', text: 'hi' }] });
  });

  it('returns 500 when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../claude');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { systemPrompt: 'system', messages: [{ role: 'user', content: 'hello' }] }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_MISCONFIGURED');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
