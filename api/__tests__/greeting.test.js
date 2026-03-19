const { createReqRes } = require('./testHelpers');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

function buildSupabaseClient({
  user = { id: 'user-1', user_metadata: { display_name: 'Laurent' } },
  profile = { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 0 },
  missingTutorialCounterColumn = false,
  updateError = null
} = {}) {
  let profileRow = profile;
  const profileSelect = jest.fn().mockImplementation((selectedColumns = '') => {
    if (missingTutorialCounterColumn && String(selectedColumns).includes('greeting_tutorial_sessions_count')) {
      return Promise.resolve({
        data: null,
        error: { code: '42703', message: 'column "greeting_tutorial_sessions_count" does not exist' }
      });
    }

    return Promise.resolve({
      data: profileRow,
      error: null
    });
  });

  const profileUpdateEq = jest.fn().mockImplementation(() => {
    if (!updateError && profileRow && typeof profileRow === 'object') {
      return Promise.resolve({ error: null });
    }
    return Promise.resolve({ error: updateError });
  });

  const profileUpdate = jest.fn().mockImplementation((updates) => {
    if (!updateError && profileRow && typeof profileRow === 'object') {
      profileRow = { ...profileRow, ...updates };
    }
    return {
      eq: profileUpdateEq
    };
  });

  return {
    client: {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user },
          error: user ? null : { message: 'invalid jwt' }
        })
      },
      from: jest.fn((table) => {
        if (table !== 'profiles') {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          select: (selectedColumns) => ({
            eq: () => ({
              maybeSingle: () => profileSelect(selectedColumns)
            })
          }),
          update: profileUpdate
        };
      })
    },
    spies: {
      profileSelect,
      profileUpdate,
      profileUpdateEq
    }
  };
}

function createJsonTextResponse(ok, jsonPayload, textPayload = '') {
  return {
    ok,
    status: ok ? 200 : 500,
    json: jest.fn().mockResolvedValue(jsonPayload ?? {}),
    text: jest.fn().mockResolvedValue(textPayload)
  };
}

function installFetchMock() {
  const fetchMock = jest.fn().mockImplementation((url) => {
    const target = String(url);

    if (target === ANTHROPIC_API_URL) {
      return Promise.resolve(
        createJsonTextResponse(true, {
          id: 'msg_greeting',
          content: [
            {
              type: 'text',
              text: "Hey Laurent, ça va? J'suis le clone de Cathy. Le micro en bas c'est pour me parler direct, pis si t'aimes mieux texter, clique dessus."
            }
          ]
        })
      );
    }

    if (target.startsWith(OPEN_METEO_FORECAST_URL)) {
      return Promise.resolve(
        createJsonTextResponse(true, {
          current: {
            temperature_2m: -2,
            weather_code: 3
          },
          daily: {
            temperature_2m_max: [1],
            temperature_2m_min: [-5],
            weather_code: [3]
          }
        })
      );
    }

    if (target.includes('/rss')) {
      return Promise.resolve(createJsonTextResponse(false, {}, ''));
    }

    if (target.includes('ipapi.co')) {
      return Promise.resolve(
        createJsonTextResponse(true, {
          latitude: 45.5017,
          longitude: -73.5673,
          city: 'Montreal',
          country_code: 'CA'
        })
      );
    }

    return Promise.resolve(createJsonTextResponse(true, {}));
  });

  global.fetch = fetchMock;
  return fetchMock;
}

describe('api/greeting tutorial behavior', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-api-key';
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
  });

  it('activates tutorial for first session greeting when count is 0 and increments counter', async () => {
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 0 }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    const fetchMock = installFetchMock();

    const handler = require('../greeting');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer token' },
      body: {
        artistId: 'cathy-gauthier',
        language: 'fr-CA',
        isSessionFirstGreeting: true,
        availableModes: ['On Jase', 'Jeux'],
        coords: { lat: 45.5, lon: -73.5 }
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.tutorial).toEqual({
      active: true,
      sessionIndex: 1,
      connectionLimit: 3,
      modeNudgeAfterUserMessages: 2
    });
    expect(supabase.spies.profileUpdate).toHaveBeenCalledWith({
      greeting_tutorial_sessions_count: 1
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toBe(ANTHROPIC_API_URL);
  });

  it('keeps tutorial active at session 3 and increments to 3', async () => {
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 2 }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    installFetchMock();

    const handler = require('../greeting');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer token' },
      body: {
        artistId: 'cathy-gauthier',
        language: 'fr-CA',
        isSessionFirstGreeting: true,
        availableModes: ['On Jase', 'Jeux'],
        coords: { lat: 45.5, lon: -73.5 }
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.tutorial.active).toBe(true);
    expect(res.payload.tutorial.sessionIndex).toBe(3);
    expect(supabase.spies.profileUpdate).toHaveBeenCalledWith({
      greeting_tutorial_sessions_count: 3
    });
  });

  it('disables tutorial when count reached 3 and allows contextual fetches', async () => {
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 3 }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    const fetchMock = installFetchMock();

    const handler = require('../greeting');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer token' },
      body: {
        artistId: 'cathy-gauthier',
        language: 'fr-CA',
        isSessionFirstGreeting: true,
        availableModes: ['On Jase', 'Jeux'],
        coords: { lat: 45.5, lon: -73.5 }
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.tutorial.active).toBe(false);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not increment tutorial counter when isSessionFirstGreeting is false', async () => {
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 1 }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    installFetchMock();

    const handler = require('../greeting');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer token' },
      body: {
        artistId: 'cathy-gauthier',
        language: 'fr-CA',
        isSessionFirstGreeting: false,
        availableModes: ['On Jase', 'Jeux'],
        coords: { lat: 45.5, lon: -73.5 }
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.tutorial.active).toBe(false);
    expect(supabase.spies.profileUpdate).not.toHaveBeenCalled();
  });

  it('falls back to session-only tutorial mode when counter column is missing', async () => {
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus' },
      missingTutorialCounterColumn: true
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    const fetchMock = installFetchMock();

    const handler = require('../greeting');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer token' },
      body: {
        artistId: 'cathy-gauthier',
        language: 'fr-CA',
        isSessionFirstGreeting: true,
        availableModes: ['On Jase', 'Jeux'],
        coords: { lat: 45.5, lon: -73.5 }
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.tutorial.active).toBe(true);
    expect(supabase.spies.profileSelect).toHaveBeenCalledTimes(2);
    expect(supabase.spies.profileUpdate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
