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

function createAnthropicErrorResponse({ status, message, type, retryAfter }) {
  return {
    ok: false,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'retry-after' ? retryAfter ?? null : null;
      }
    },
    json: jest.fn().mockResolvedValue({
      error: {
        message,
        type
      }
    })
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

function installFetchMockWithOptions({
  anthropicText,
  rssXml = null
}) {
  const resolvedAnthropicText =
    typeof anthropicText === 'string' && anthropicText.trim()
      ? anthropicText.trim()
      : "Hey Laurent, ça va? J'suis le clone de Cathy. Le micro en bas c'est pour me parler direct, pis si t'aimes mieux texter, clique dessus.";
  const fetchMock = jest.fn().mockImplementation((url) => {
    const target = String(url);

    if (target === ANTHROPIC_API_URL) {
      return Promise.resolve(
        createJsonTextResponse(true, {
          id: 'msg_greeting',
          content: [
            {
              type: 'text',
              text: resolvedAnthropicText
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
      if (typeof rssXml === 'string' && rssXml.trim()) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({}),
          text: jest.fn().mockResolvedValue(rssXml)
        });
      }
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

function countWords(text) {
  return String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function countSentences(text) {
  return String(text ?? '')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean).length;
}

function extractAnthropicRequestBody(fetchMock) {
  const call = fetchMock.mock.calls.find((entry) => String(entry[0]) === ANTHROPIC_API_URL);
  if (!call) {
    return null;
  }
  return JSON.parse(call?.[1]?.body ?? '{}');
}

describe('api/greeting tutorial behavior', () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GREETING_FORCE_TUTORIAL: process.env.GREETING_FORCE_TUTORIAL,
    GREETING_HEADLINE_INCLUSION_RATE: process.env.GREETING_HEADLINE_INCLUSION_RATE
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-api-key';
    delete process.env.GREETING_FORCE_TUTORIAL;
    delete process.env.GREETING_HEADLINE_INCLUSION_RATE;
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
    if (typeof originalEnv.GREETING_FORCE_TUTORIAL === 'string') {
      process.env.GREETING_FORCE_TUTORIAL = originalEnv.GREETING_FORCE_TUTORIAL;
    } else {
      delete process.env.GREETING_FORCE_TUTORIAL;
    }
    if (typeof originalEnv.GREETING_HEADLINE_INCLUSION_RATE === 'string') {
      process.env.GREETING_HEADLINE_INCLUSION_RATE = originalEnv.GREETING_HEADLINE_INCLUSION_RATE;
    } else {
      delete process.env.GREETING_HEADLINE_INCLUSION_RATE;
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
      connectionLimit: 1,
      modeNudgeAfterUserMessages: 2
    });
    const anthropicBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? '{}');
    expect(anthropicBody.system).toContain('Écris 2 à 4 phrases courtes (20 à 70 mots au total)');
    expect(anthropicBody.system).toContain('Cette règle a priorité sur la règle 3');
    expect(supabase.spies.profileUpdate).toHaveBeenCalledWith({
      greeting_tutorial_sessions_count: 1
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toBe(ANTHROPIC_API_URL);
  });

  it('disables tutorial when count reached 1 and allows contextual fetches', async () => {
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 1 }
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

  it('applies short non-tutorial prompt and clamps reply to 3 sentences / 45 words', async () => {
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 1 }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    const longText = [
      "Hey Laurent, je déborde d'énergie aujourd'hui et j'arrive avec une joke beaucoup trop longue juste pour voir si tu suis encore, ce qui est déjà un miracle.",
      "J'ai vu une manchette absurde, la météo capote, puis ton signe astro me juge silencieusement pendant que j'essaie de rester élégante.",
      "Bref, écris-moi une ligne et on démarre ça.",
      "Cette phrase en trop ne devrait jamais survivre au clamp final."
    ].join(' ');
    const fetchMock = installFetchMockWithOptions({ anthropicText: longText });

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
    expect(countSentences(res.payload.greeting)).toBeLessThanOrEqual(3);
    expect(countWords(res.payload.greeting)).toBeLessThanOrEqual(45);
    const anthropicBody = extractAnthropicRequestBody(fetchMock);
    expect(anthropicBody).toBeTruthy();
    expect(anthropicBody.system).toContain('Écris exactement 2 à 3 phrases courtes (20 à 45 mots au total).');
  });

  it('skips RSS fetches and marks headline context unavailable when news gate is off', async () => {
    process.env.GREETING_HEADLINE_INCLUSION_RATE = '0';
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 1 }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    const fetchMock = installFetchMockWithOptions({
      anthropicText: "Hey Laurent, ça va? On part ça vite."
    });

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
    const rssCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/rss'));
    expect(rssCalls).toHaveLength(0);
    const anthropicBody = extractAnthropicRequestBody(fetchMock);
    expect(anthropicBody).toBeTruthy();
    expect(anthropicBody.messages?.[0]?.content).toContain('Contexte manchette disponible: non');
  });

  it('fetches RSS signals and marks headline context available when news gate is on', async () => {
    process.env.GREETING_HEADLINE_INCLUSION_RATE = '1';
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 1 }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    const rssXml = `
      <rss version="2.0">
        <channel>
          <item>
            <title>Québec: Une manchette test</title>
            <link>https://example.com/quebec</link>
            <pubDate>Mon, 25 Mar 2024 12:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    `;
    const fetchMock = installFetchMockWithOptions({
      anthropicText: "Hey Laurent, ça va? On part ça vite.",
      rssXml
    });

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
    const rssCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/rss'));
    expect(rssCalls.length).toBeGreaterThan(0);
    const anthropicBody = extractAnthropicRequestBody(fetchMock);
    expect(anthropicBody).toBeTruthy();
    expect(anthropicBody.messages?.[0]?.content).toContain('Contexte manchette disponible: oui');
  });

  it('injects recent activity prompt signals when provided by the client payload', async () => {
    process.env.GREETING_HEADLINE_INCLUSION_RATE = '0';
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 1 }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    const fetchMock = installFetchMockWithOptions({
      anthropicText: "Hey Laurent, j'ai vu ton activite, on continue?"
    });

    const handler = require('../greeting');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer token' },
      body: {
        artistId: 'cathy-gauthier',
        language: 'fr-CA',
        isSessionFirstGreeting: false,
        availableModes: ['On Jase', 'Jeux'],
        recentActivityFacts: ["T'as bouge dans des jeux/defis depuis mon dernier coucou."],
        askActivityFeedback: true,
        recentExperienceName: 'Tirage de Tarot',
        recentExperienceType: 'game',
        activityFeedbackCue: "Pis, t'aimes ton avenir?",
        lastGreetingSnippet: "Hey Laurent, comment tu vas?",
        coords: { lat: 45.5, lon: -73.5 }
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const anthropicBody = extractAnthropicRequestBody(fetchMock);
    expect(anthropicBody).toBeTruthy();
    expect(anthropicBody.messages?.[0]?.content).toContain('Contexte activite recente:');
    expect(anthropicBody.messages?.[0]?.content).toContain('Nom experience recente: Tirage de Tarot');
    expect(anthropicBody.messages?.[0]?.content).toContain('Type experience recente: game');
    expect(anthropicBody.messages?.[0]?.content).toContain('Demander feedback activite: oui');
    expect(anthropicBody.messages?.[0]?.content).toContain("Cue feedback activite: Pis, t'aimes ton avenir?");
    expect(anthropicBody.messages?.[0]?.content).toContain('Extrait dernier greeting:');
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

  it('generates mode_intro for on-jase without tutorial side effects', async () => {
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 0 }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    const fetchMock = installFetchMockWithOptions({
      anthropicText: "Hey Laurent, mode Dis-moi la verite active. J'te dis la vraie affaire sans te planter. Raconte-moi ton probleme concret."
    });

    const handler = require('../greeting');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer token' },
      body: {
        artistId: 'cathy-gauthier',
        language: 'fr-CA',
        introType: 'mode_intro',
        modeId: 'on-jase',
        isSessionFirstGreeting: true,
        preferredName: 'Laurent'
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.greeting).toContain('Laurent');
    expect(res.payload.tutorial).toBeUndefined();
    const anthropicBody = extractAnthropicRequestBody(fetchMock);
    expect(anthropicBody.system).toContain('Tu ouvres le mode "Dis-moi la verite".');
    expect(anthropicBody.messages?.[0]?.content).toContain('Mode ID: on-jase');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toBe(ANTHROPIC_API_URL);
    expect(supabase.spies.profileUpdate).not.toHaveBeenCalled();
  });

  it('rejects retired compatibility mode ids for mode_intro prompting', async () => {
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 0 }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    const fetchMock = installFetchMockWithOptions({
      anthropicText: "Hey Laurent, Mets-moi sur le grill est active. Tu veux du feu? Donne-moi un detail concret et je m'occupe du reste."
    });

    const handler = require('../greeting');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer token' },
      body: {
        artistId: 'cathy-gauthier',
        language: 'fr-CA',
        introType: 'mode_intro',
        modeId: 'roast',
        isSessionFirstGreeting: false
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(supabase.spies.profileUpdate).not.toHaveBeenCalled();
  });

  it('supports meme-generator mode_intro and asks for image upload plus short text context', async () => {
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 0 }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    const fetchMock = installFetchMockWithOptions({
      anthropicText: 'Upload your image and I will generate three meme options.'
    });

    const handler = require('../greeting');
    const { req, res } = createReqRes({
      headers: { authorization: 'Bearer token' },
      body: {
        artistId: 'cathy-gauthier',
        language: 'en-CA',
        introType: 'mode_intro',
        modeId: 'meme-generator',
        isSessionFirstGreeting: false
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const anthropicBody = extractAnthropicRequestBody(fetchMock);
    expect(anthropicBody.system).toContain('You are opening the mode "Meme Generator".');
    expect(anthropicBody.system).toContain('Start with the user\'s first name when available.');
    expect(anthropicBody.system).toContain('add a short text context because it helps make funnier memes');
    expect(anthropicBody.system).toContain('small + on the left of the text composer');
    expect(anthropicBody.messages?.[0]?.content).toContain('Mode ID: meme-generator');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(supabase.spies.profileUpdate).not.toHaveBeenCalled();
  });

  it('rejects mode_intro payloads without modeId', async () => {
    const supabase = buildSupabaseClient();
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
        introType: 'mode_intro'
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(String(res.payload?.error?.message ?? '')).toContain('modeId is required');
    expect(fetchMock).toHaveBeenCalledTimes(0);
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

  it('returns 503 with Retry-After when Anthropic is overloaded', async () => {
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 0 }
    });
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => supabase.client)
    }));
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (String(url) === ANTHROPIC_API_URL) {
        return Promise.resolve(
          createAnthropicErrorResponse({
            status: 529,
            message: 'Overloaded',
            type: 'overloaded_error',
            retryAfter: '11'
          })
        );
      }
      return Promise.resolve(createJsonTextResponse(true, {}));
    });
    global.fetch = fetchMock;

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

    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('11');
    expect(res.payload.error.code).toBe('UPSTREAM_OVERLOADED');
    expect(String(res.payload.error.message ?? '')).toContain('temporarily overloaded');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forces tutorial greeting copy without changing tutorial.active semantics when isSessionFirstGreeting is false', async () => {
    process.env.GREETING_FORCE_TUTORIAL = 'true';
    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 2 }
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
        isSessionFirstGreeting: false,
        availableModes: ['On Jase', 'Jeux'],
        preferredName: 'xX_DR4G0N',
        coords: { lat: 45.5, lon: -73.5 }
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.tutorial.active).toBe(false);
    expect(res.payload.greeting).toContain('Hey xX_DR4G0N');
    expect(res.payload.greeting).toContain('Ton prénom, j\'ai des questions - mais on réglera ça plus tard.');
    expect(res.payload.greeting.toLowerCase()).toContain('micro');
    expect(supabase.spies.profileUpdate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('forces tutorial greeting copy but never increments tutorial counter when isSessionFirstGreeting is true', async () => {
    process.env.GREETING_FORCE_TUTORIAL = 'true';
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
    expect(res.payload.tutorial.active).toBe(true);
    expect(res.payload.greeting.toLowerCase()).toContain('micro');
    expect(supabase.spies.profileUpdate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('does not require ANTHROPIC_API_KEY while GREETING_FORCE_TUTORIAL is enabled', async () => {
    process.env.GREETING_FORCE_TUTORIAL = 'true';
    delete process.env.ANTHROPIC_API_KEY;

    const supabase = buildSupabaseClient({
      profile: { horoscope_sign: 'taurus', greeting_tutorial_sessions_count: 1 }
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
        isSessionFirstGreeting: false,
        availableModes: ['On Jase', 'Jeux'],
        coords: { lat: 45.5, lon: -73.5 }
      }
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.greeting.toLowerCase()).toContain('micro');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
