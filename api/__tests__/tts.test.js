const { createReqRes } = require('./testHelpers');

function buildSupabaseClient({
  user = { id: 'user-1', app_metadata: { account_type: 'regular' } },
  profileAccountType = 'regular',
  initialUsageCount = 0,
  usageCountError = null,
  usageInsertError = null
} = {}) {
  let usageCount = initialUsageCount;

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
    if (!usageInsertError) {
      usageCount += 1;
    }

    return Promise.resolve({ error: usageInsertError });
  });

  const profileMaybeSingle = jest.fn().mockResolvedValue({
    data: { account_type_id: profileAccountType },
    error: null
  });

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: 'invalid jwt' }
      })
    },
    from: jest.fn((table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: profileMaybeSingle
            })
          })
        };
      }

      if (table === 'usage_events') {
        return {
          select: usageSelect,
          insert: usageInsert
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    })
  };
}

describe('api/tts', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    ELEVENLABS_MODEL_ID: process.env.ELEVENLABS_MODEL_ID,
    ELEVENLABS_VOICE_ID_GENERIC: process.env.ELEVENLABS_VOICE_ID_GENERIC,
    ELEVENLABS_VOICE_ID_CATHY: process.env.ELEVENLABS_VOICE_ID_CATHY,
    ELEVENLABS_VOICE_ID_REGULAR: process.env.ELEVENLABS_VOICE_ID_REGULAR,
    ELEVENLABS_VOICE_ID_PREMIUM: process.env.ELEVENLABS_VOICE_ID_PREMIUM,
    ELEVENLABS_USE_CATHY_FOR_ALL_PAID: process.env.ELEVENLABS_USE_CATHY_FOR_ALL_PAID,
    TTS_MONTHLY_CAP_REGULAR: process.env.TTS_MONTHLY_CAP_REGULAR,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC: process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC,
    EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY: process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ELEVENLABS_API_KEY = 'eleven-api-key';
    delete process.env.ELEVENLABS_MODEL_ID;
    delete process.env.ELEVENLABS_VOICE_ID_GENERIC;
    delete process.env.ELEVENLABS_VOICE_ID_CATHY;
    delete process.env.ELEVENLABS_VOICE_ID_REGULAR;
    delete process.env.ELEVENLABS_VOICE_ID_PREMIUM;
    delete process.env.ELEVENLABS_USE_CATHY_FOR_ALL_PAID;
    delete process.env.TTS_MONTHLY_CAP_REGULAR;
    process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC = 'generic-voice-id';
    process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY = 'premium-voice-id';
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

    if (typeof originalEnv.ELEVENLABS_API_KEY === 'string') {
      process.env.ELEVENLABS_API_KEY = originalEnv.ELEVENLABS_API_KEY;
    } else {
      delete process.env.ELEVENLABS_API_KEY;
    }

    if (typeof originalEnv.ELEVENLABS_MODEL_ID === 'string') {
      process.env.ELEVENLABS_MODEL_ID = originalEnv.ELEVENLABS_MODEL_ID;
    } else {
      delete process.env.ELEVENLABS_MODEL_ID;
    }

    if (typeof originalEnv.ELEVENLABS_VOICE_ID_GENERIC === 'string') {
      process.env.ELEVENLABS_VOICE_ID_GENERIC = originalEnv.ELEVENLABS_VOICE_ID_GENERIC;
    } else {
      delete process.env.ELEVENLABS_VOICE_ID_GENERIC;
    }

    if (typeof originalEnv.ELEVENLABS_VOICE_ID_CATHY === 'string') {
      process.env.ELEVENLABS_VOICE_ID_CATHY = originalEnv.ELEVENLABS_VOICE_ID_CATHY;
    } else {
      delete process.env.ELEVENLABS_VOICE_ID_CATHY;
    }

    if (typeof originalEnv.ELEVENLABS_VOICE_ID_REGULAR === 'string') {
      process.env.ELEVENLABS_VOICE_ID_REGULAR = originalEnv.ELEVENLABS_VOICE_ID_REGULAR;
    } else {
      delete process.env.ELEVENLABS_VOICE_ID_REGULAR;
    }

    if (typeof originalEnv.ELEVENLABS_VOICE_ID_PREMIUM === 'string') {
      process.env.ELEVENLABS_VOICE_ID_PREMIUM = originalEnv.ELEVENLABS_VOICE_ID_PREMIUM;
    } else {
      delete process.env.ELEVENLABS_VOICE_ID_PREMIUM;
    }

    if (typeof originalEnv.ELEVENLABS_USE_CATHY_FOR_ALL_PAID === 'string') {
      process.env.ELEVENLABS_USE_CATHY_FOR_ALL_PAID = originalEnv.ELEVENLABS_USE_CATHY_FOR_ALL_PAID;
    } else {
      delete process.env.ELEVENLABS_USE_CATHY_FOR_ALL_PAID;
    }

    if (typeof originalEnv.TTS_MONTHLY_CAP_REGULAR === 'string') {
      process.env.TTS_MONTHLY_CAP_REGULAR = originalEnv.TTS_MONTHLY_CAP_REGULAR;
    } else {
      delete process.env.TTS_MONTHLY_CAP_REGULAR;
    }

    if (typeof originalEnv.ALLOWED_ORIGINS === 'string') {
      process.env.ALLOWED_ORIGINS = originalEnv.ALLOWED_ORIGINS;
    } else {
      delete process.env.ALLOWED_ORIGINS;
    }

    if (typeof originalEnv.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC === 'string') {
      process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC = originalEnv.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC;
    } else {
      delete process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC;
    }

    if (typeof originalEnv.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY === 'string') {
      process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY = originalEnv.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY;
    } else {
      delete process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY;
    }
  });

  it('returns 401 when bearer token is missing', async () => {
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { origin: 'https://app.example.com' },
      body: { text: 'bonjour', artistId: 'cathy-gauthier', language: 'fr-CA' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload.error.code).toBe('UNAUTHORIZED');
  });

  it('accepts free tier voice requests while under monthly cap', async () => {
    const audioBytes = Uint8Array.from([5, 4, 3, 2]).buffer;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: jest.fn().mockResolvedValue(audioBytes)
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'free-user', app_metadata: { account_type: 'free' } },
          profileAccountType: 'free',
          initialUsageCount: 12
        })
      )
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer free-token' },
      body: { text: 'bonjour', artistId: 'cathy-gauthier', language: 'fr-CA' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns 429 when regular tier monthly TTS cap is reached', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'regular-user', app_metadata: { account_type: 'regular' } },
          profileAccountType: 'regular',
          initialUsageCount: 2000
        })
      )
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer free-cap-token' },
      body: { text: 'bonjour', artistId: 'cathy-gauthier', language: 'fr-CA' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(429);
    expect(res.payload.error.code).toBe('TTS_QUOTA_EXCEEDED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 429 when free tier monthly TTS cap is reached', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'free-user-cap', app_metadata: { account_type: 'free' } },
          profileAccountType: 'free',
          initialUsageCount: 80
        })
      )
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer regular-token' },
      body: { text: 'bonjour', artistId: 'cathy-gauthier', language: 'fr-CA' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(429);
    expect(res.payload.error.code).toBe('TTS_QUOTA_EXCEEDED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['free', 20],
    ['regular', 60],
    ['premium', 180]
  ])('enforces Pack A per-minute rate limit for %s tier', async (accountType, usedInWindow) => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: `${accountType}-rate-user`, app_metadata: { account_type: accountType } },
          profileAccountType: accountType,
          initialUsageCount: usedInWindow
        })
      )
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: `Bearer ${accountType}-token` },
      body: { text: 'bonjour rate limit', artistId: 'cathy-gauthier', language: 'fr-CA' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(429);
    expect(res.payload.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns audio/mpeg payload for paid tier requests', async () => {
    const audioBytes = Uint8Array.from([1, 2, 3, 4]).buffer;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: jest.fn().mockResolvedValue(audioBytes)
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'premium-user', app_metadata: { account_type: 'premium' } },
          profileAccountType: 'premium',
          initialUsageCount: 0
        })
      )
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer premium-token' },
      body: { text: 'bonjour tout le monde', artistId: 'cathy-gauthier', language: 'fr-CA' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('audio/mpeg');
    expect(Buffer.isBuffer(res.payload)).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/premium-voice-id');
  });

  it('forwards ISO language_code derived from conversation language when supported', async () => {
    const audioBytes = Uint8Array.from([9, 9, 9, 9]).buffer;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: jest.fn().mockResolvedValue(audioBytes)
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { text: 'hola que tal', artistId: 'cathy-gauthier', language: 'es-ES' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const requestPayload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(requestPayload.language_code).toBe('es');
  });

  it('retries once without language_code when provider rejects locale parameter', async () => {
    const audioBytes = Uint8Array.from([8, 8, 8, 8]).buffer;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue('invalid language_code')
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: jest.fn().mockResolvedValue(audioBytes)
      });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { text: 'hola retry', artistId: 'cathy-gauthier', language: 'es-ES' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(global.fetch.mock.calls[0][1].body);
    const secondPayload = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(firstPayload.language_code).toBe('es');
    expect(secondPayload.language_code).toBeUndefined();
  });

  it('treats role=admin as unlimited even when account_type is regular', async () => {
    const audioBytes = Uint8Array.from([7, 7, 7, 7]).buffer;
    process.env.TTS_MONTHLY_CAP_REGULAR = '1';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: jest.fn().mockResolvedValue(audioBytes)
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'role-admin-user', app_metadata: { role: 'admin', account_type: 'regular' } },
          profileAccountType: 'regular',
          initialUsageCount: 1
        })
      )
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer role-admin-token' },
      body: { text: 'bonjour admin', artistId: 'cathy-gauthier', language: 'fr-CA' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('maps ELEVENLABS_MODEL_ID alias 2.5 to eleven_turbo_v2_5', async () => {
    const audioBytes = Uint8Array.from([4, 3, 2, 1]).buffer;
    process.env.ELEVENLABS_MODEL_ID = '2.5';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: jest.fn().mockResolvedValue(audioBytes)
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'premium-user-model-alias', app_metadata: { account_type: 'premium' } },
          profileAccountType: 'premium',
          initialUsageCount: 0
        })
      )
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer premium-token' },
      body: { text: 'bonjour model alias', artistId: 'cathy-gauthier', language: 'fr-CA' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.model_id).toBe('eleven_turbo_v2_5');
  });

  it('uses Cathy voice for regular tier when Cathy voice is configured', async () => {
    const audioBytes = Uint8Array.from([6, 6, 6, 6]).buffer;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: jest.fn().mockResolvedValue(audioBytes)
    });
    process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY = 'cathy-voice-id';
    process.env.ELEVENLABS_USE_CATHY_FOR_ALL_PAID = 'true';

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'regular-user-cathy', app_metadata: { account_type: 'regular' } },
          profileAccountType: 'regular',
          initialUsageCount: 0
        })
      )
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer regular-token' },
      body: { text: 'bonjour regular voice', artistId: 'cathy-gauthier', language: 'fr-CA' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/cathy-voice-id');
  });

  it('accepts legacy paid aliases and maps pro artist to premium voice', async () => {
    const audioBytes = Uint8Array.from([9, 8, 7, 6]).buffer;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: jest.fn().mockResolvedValue(audioBytes)
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'legacy-paid-user', app_metadata: { account_type: 'proArtist' } },
          profileAccountType: 'pro_artist',
          initialUsageCount: 0
        })
      )
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer legacy-paid-token' },
      body: { text: 'bonjour legacy', artistId: 'cathy-gauthier', language: 'fr-CA' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/premium-voice-id');
  });

  it('returns 400 when artist is unsupported', async () => {
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { text: 'bonjour', artistId: 'unknown-artist', language: 'fr-CA' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error.code).toBe('INVALID_REQUEST');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 500 when ELEVENLABS_API_KEY is missing', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => buildSupabaseClient())
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer valid-token' },
      body: { text: 'bonjour', artistId: 'cathy-gauthier', language: 'fr-CA' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.payload.error.code).toBe('SERVER_MISCONFIGURED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('maps ElevenLabs 402 response to TTS_QUOTA_EXCEEDED', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: jest.fn().mockResolvedValue('quota exceeded')
    });

    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() =>
        buildSupabaseClient({
          user: { id: 'regular-user', app_metadata: { account_type: 'regular' } },
          profileAccountType: 'regular',
          initialUsageCount: 0
        })
      )
    }));

    const handler = require('../../src/server/ttsHandler');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer regular-token' },
      body: { text: 'bonjour', artistId: 'cathy-gauthier', language: 'fr-CA' }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(429);
    expect(res.payload.error.code).toBe('TTS_QUOTA_EXCEEDED');
  });
});
