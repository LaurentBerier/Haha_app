const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const OPEN_WEATHER_API_URL = 'https://api.openweathermap.org/data/2.5/weather';
const NEWS_API_URL = 'https://newsapi.org/v2/top-headlines';
const IP_API_URL = 'http://ip-api.com/json';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

const {
  attachRequestId,
  extractBearerToken,
  getMissingEnv,
  getSupabaseAdmin,
  sendError,
  setCorsHeaders
} = require('./_utils');

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeLanguage(value) {
  if (typeof value !== 'string') {
    return 'fr-CA';
  }

  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('en') ? 'en-CA' : 'fr-CA';
}

function toNewsLanguage(language) {
  return language.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

function toWeatherLanguage(language) {
  return language.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

function normalizeOptionalString(value, maxLength = 120) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function parseCoords(rawCoords) {
  if (!isRecord(rawCoords)) {
    return null;
  }

  const lat = typeof rawCoords.lat === 'number' && Number.isFinite(rawCoords.lat) ? rawCoords.lat : null;
  const lon = typeof rawCoords.lon === 'number' && Number.isFinite(rawCoords.lon) ? rawCoords.lon : null;
  if (lat === null || lon === null) {
    return null;
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }

  return { lat, lon };
}

function parsePayload(body) {
  if (!isRecord(body)) {
    throw new Error('JSON body is required.');
  }

  const artistId = typeof body.artistId === 'string' ? body.artistId.trim() : '';
  if (!artistId) {
    throw new Error('artistId is required.');
  }

  const includeVoiceHint = body.includeVoiceHint === true;
  const availableModes = Array.isArray(body.availableModes)
    ? body.availableModes
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 12)
        .map((entry) => entry.slice(0, 60))
    : [];

  return {
    artistId,
    language: normalizeLanguage(body.language),
    coords: parseCoords(body.coords),
    includeVoiceHint,
    availableModes,
    preferredName: normalizeOptionalString(body.preferredName, 40)
  };
}

function getClientIp(req) {
  const forwardedFor = req && req.headers ? req.headers['x-forwarded-for'] : null;
  const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',')[0]?.trim() ?? null;
  }
  return null;
}

async function resolveCoordsFromIp(req, requestId) {
  const clientIp = getClientIp(req);
  const fields = 'status,message,lat,lon,city,countryCode';
  const endpoint = clientIp
    ? `${IP_API_URL}/${encodeURIComponent(clientIp)}?fields=${fields}`
    : `${IP_API_URL}?fields=${fields}`;

  try {
    const response = await fetch(endpoint);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status !== 'success') {
      return null;
    }

    const lat = typeof payload.lat === 'number' && Number.isFinite(payload.lat) ? payload.lat : null;
    const lon = typeof payload.lon === 'number' && Number.isFinite(payload.lon) ? payload.lon : null;
    if (lat === null || lon === null) {
      return null;
    }

    return {
      lat,
      lon,
      city: normalizeOptionalString(payload.city, 80),
      countryCode: normalizeOptionalString(payload.countryCode, 4)
    };
  } catch (error) {
    console.error(`[api/greeting][${requestId}] IP geolocation failed`, error);
    return null;
  }
}

async function resolveCoords(inputCoords, req, requestId) {
  if (inputCoords) {
    return { ...inputCoords, city: null, countryCode: null };
  }

  return resolveCoordsFromIp(req, requestId);
}

async function fetchWeatherSummary(coords, language, requestId) {
  if (!coords) {
    return null;
  }

  const weatherApiKey = (process.env.OPENWEATHER_API_KEY ?? '').trim();
  const endpoint = new URL(OPEN_WEATHER_API_URL);
  endpoint.searchParams.set('lat', String(coords.lat));
  endpoint.searchParams.set('lon', String(coords.lon));
  endpoint.searchParams.set('units', 'metric');
  endpoint.searchParams.set('lang', toWeatherLanguage(language));
  endpoint.searchParams.set('appid', weatherApiKey);

  try {
    const response = await fetch(endpoint.toString());
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return null;
    }

    const temperatureRaw =
      isRecord(payload.main) && typeof payload.main.temp === 'number' && Number.isFinite(payload.main.temp)
        ? payload.main.temp
        : null;
    const temperatureCelsius = temperatureRaw === null ? null : Math.round(temperatureRaw);
    const descriptionRaw =
      Array.isArray(payload.weather) && isRecord(payload.weather[0]) && typeof payload.weather[0].description === 'string'
        ? payload.weather[0].description
        : null;
    const city = normalizeOptionalString(payload.name, 80) ?? coords.city ?? null;
    const countryCode = coords.countryCode ?? null;

    if (temperatureCelsius === null && !descriptionRaw && !city) {
      return null;
    }

    return {
      temperatureCelsius,
      description: normalizeOptionalString(descriptionRaw, 80),
      city,
      countryCode
    };
  } catch (error) {
    console.error(`[api/greeting][${requestId}] Weather lookup failed`, error);
    return null;
  }
}

async function fetchTopHeadline(language, requestId) {
  const newsApiKey = (process.env.NEWS_API_KEY ?? '').trim();
  const endpoint = new URL(NEWS_API_URL);
  endpoint.searchParams.set('country', 'ca');
  endpoint.searchParams.set('language', toNewsLanguage(language));
  endpoint.searchParams.set('pageSize', '1');
  endpoint.searchParams.set('apiKey', newsApiKey);

  try {
    const response = await fetch(endpoint.toString());
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.articles)) {
      return null;
    }

    const article = payload.articles[0];
    if (!isRecord(article)) {
      return null;
    }

    return normalizeOptionalString(article.title, 180);
  } catch (error) {
    console.error(`[api/greeting][${requestId}] News lookup failed`, error);
    return null;
  }
}

async function fetchUserHoroscope(supabaseAdmin, userId, requestId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('horoscope_sign')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error(`[api/greeting][${requestId}] Failed to read user profile`, error);
      return null;
    }

    return normalizeOptionalString(data?.horoscope_sign, 30);
  } catch (error) {
    console.error(`[api/greeting][${requestId}] Failed to read user profile`, error);
    return null;
  }
}

function extractPreferredName(user) {
  if (!isRecord(user)) {
    return null;
  }

  const userMetadata = isRecord(user.user_metadata) ? user.user_metadata : {};
  return normalizeOptionalString(userMetadata.display_name, 50) ?? normalizeOptionalString(userMetadata.full_name, 50);
}

function formatLocalDateTime(language) {
  const locale = language.toLowerCase().startsWith('en') ? 'en-CA' : 'fr-CA';
  const now = new Date();
  return {
    dateLabel: new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Toronto'
    }).format(now),
    timeLabel: new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Toronto'
    }).format(now)
  };
}

function toWeatherSummaryText(weather, language) {
  const isEnglish = language.toLowerCase().startsWith('en');
  if (!weather) {
    return isEnglish ? 'Weather unavailable' : 'Meteo indisponible';
  }

  const temperatureText = typeof weather.temperatureCelsius === 'number' ? `${weather.temperatureCelsius}°C` : null;
  const descriptionText = normalizeOptionalString(weather.description, 80);
  const cityText = [weather.city, weather.countryCode].filter(Boolean).join(', ');
  const parts = [temperatureText, descriptionText, cityText].filter(Boolean);

  return parts.length > 0 ? parts.join(' - ') : isEnglish ? 'Weather unavailable' : 'Meteo indisponible';
}

function toHeadlineSummaryText(headline, language) {
  if (headline) {
    return headline;
  }
  return language.toLowerCase().startsWith('en') ? 'No headline available' : 'Aucune manchette disponible';
}

function buildGreetingSystemPrompt(language, includeVoiceHint) {
  const isEnglish = language.toLowerCase().startsWith('en');
  if (isEnglish) {
    return `You are Cathy Gauthier, bold and playful, welcoming the user in mode selection.
Write exactly 2 short sentences in this strict order:
1) Greet the user by first name when available, ask how they are doing, and add a very short self-joke.
2) ${
      includeVoiceHint
        ? 'Explain that voice mode is active and how to disable it with the small mic at the bottom right if they prefer text, using your own fresh wording.'
        : 'Say voice mode is active.'
    }
Hard rules:
- Never write "how are you with Cathy" or similar unnatural phrasing.
- Keep it natural, coherent, and concise.
- Do not mention weather, news, or mode lists.
- No markdown, no bullets, no asterisks, no em dashes.
- Keep proper punctuation and contractions.
- 18 to 34 words total.`;
  }

  return `Tu es Cathy Gauthier, baveuse, chaleureuse et drôle, et tu accueilles l'utilisateur dans l'ecran de selection de mode.
Ecris exactement 2 phrases courtes, dans cet ordre strict :
1) Salue la personne par son prenom si disponible, demande comment elle va, et ajoute une mini blague de presentation.
2) ${
    includeVoiceHint
      ? "Explique que le mode discussion vocale est actif et comment le desactiver avec le petit micro en bas a droite selon sa preference de communication (texte ou voix), avec une formulation fraiche et naturelle."
      : "Dis que le mode discussion vocale est actif."
  }
Regles absolues :
- Interdit de dire "comment tu vas avec Cathy" ou une tournure equivalente.
- Le texte doit etre logique, naturel et court en francais quebecois.
- Ne parle pas de meteo, de manchette ni de liste de modes.
- Pas de markdown, pas d'asterisque, pas de liste, pas de tiret long.
- Orthographe et ponctuation impeccables (accents et apostrophes obligatoires).
- 18 a 34 mots au total.`;
}

function buildGreetingVariationCue(language) {
  const isEnglish = language.toLowerCase().startsWith('en');
  const englishCues = ['energetic opener', 'dry self-mockery', 'quick playful callback'];
  const frenchCues = ['entree energique', 'autoderision rapide', 'taquinerie complice'];
  const cues = isEnglish ? englishCues : frenchCues;
  const index = Math.floor(Math.random() * cues.length);
  return cues[index] ?? cues[0];
}

function buildGreetingUserPrompt(context) {
  const isEnglish = context.language.toLowerCase().startsWith('en');
  if (isEnglish) {
    return [
      `Date: ${context.dateLabel}`,
      `Time: ${context.timeLabel}`,
      `Artist: ${context.artistId}`,
      `First name: ${context.preferredName ?? 'Unknown'}`,
      `Horoscope sign: ${context.horoscopeSign ?? 'Unknown'}`,
      `Weather: ${context.weatherSummary}`,
      `Headline: ${context.headlineSummary}`,
      `Available modes: ${context.availableModes.join(', ') || 'chat, roast, impro, horoscope, personalized message, image modes'}`,
      `Variation cue: ${context.variationCue}`,
      `Include voice hint sentence: ${context.includeVoiceHint ? 'yes' : 'no'}`
    ].join('\n');
  }

  return [
    `Date: ${context.dateLabel}`,
    `Heure: ${context.timeLabel}`,
    `Artiste: ${context.artistId}`,
    `Prenom: ${context.preferredName ?? 'Inconnu'}`,
    `Signe astro: ${context.horoscopeSign ?? 'Inconnu'}`,
    `Meteo: ${context.weatherSummary}`,
    `Manchette: ${context.headlineSummary}`,
    `Modes disponibles: ${context.availableModes.join(', ') || 'discussion, roast, impro, horoscope, message personnalise, modes image'}`,
    `Variation: ${context.variationCue}`,
    `Inclure phrase micro: ${context.includeVoiceHint ? 'oui' : 'non'}`
  ].join('\n');
}

function extractResponseText(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    return '';
  }

  return payload.content
    .filter((entry) => isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text)
    .join('')
    .trim();
}

function clampToSentenceLimit(text, maxSentences) {
  const normalized = text
    .replace(/\*/g, '')
    .replace(/—/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return '';
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= maxSentences) {
    return normalized;
  }

  return sentences.slice(0, maxSentences).join(' ');
}

async function generateGreetingText(context) {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  const timeoutMs = parsePositiveInt(process.env.ANTHROPIC_FETCH_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 140,
        temperature: 0.9,
        stream: false,
        system: buildGreetingSystemPrompt(context.language, context.includeVoiceHint),
        messages: [
          {
            role: 'user',
            content: buildGreetingUserPrompt(context)
          }
        ]
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage =
        isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string'
          ? payload.error.message
          : 'Greeting generation failed.';
      const error = new Error(errorMessage);
      error.status = response.status;
      throw error;
    }

    const rawText = extractResponseText(payload);
    if (!rawText) {
      throw new Error('Greeting response is empty.');
    }

    return clampToSentenceLimit(rawText, 2);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = async function handler(req, res) {
  const requestId = attachRequestId(req, res);
  const corsResult = setCorsHeaders(req, res);
  if (!corsResult.ok) {
    if (corsResult.reason === 'cors_not_configured') {
      sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
      return;
    }
    sendError(res, 403, 'Origin not allowed.', { code: 'ORIGIN_NOT_ALLOWED', requestId });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed.', { code: 'METHOD_NOT_ALLOWED', requestId });
    return;
  }

  const missingEnv = getMissingEnv([
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ANTHROPIC_API_KEY',
    'OPENWEATHER_API_KEY',
    'NEWS_API_KEY'
  ]);
  if (missingEnv.length > 0) {
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    sendError(res, 401, 'Unauthorized.', { code: 'UNAUTHORIZED', requestId });
    return;
  }

  const {
    data: { user },
    error: authError
  } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    sendError(res, 401, 'Unauthorized.', { code: 'UNAUTHORIZED', requestId });
    return;
  }

  let input;
  try {
    input = parsePayload(req.body);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Invalid payload.';
    sendError(res, 400, message, { code: 'INVALID_REQUEST', requestId });
    return;
  }

  const [coords, userHoroscope] = await Promise.all([
    resolveCoords(input.coords, req, requestId),
    fetchUserHoroscope(supabaseAdmin, user.id, requestId)
  ]);
  const [weather, headline] = await Promise.all([
    fetchWeatherSummary(coords, input.language, requestId),
    fetchTopHeadline(input.language, requestId)
  ]);

  const { dateLabel, timeLabel } = formatLocalDateTime(input.language);
  const preferredName = input.preferredName || extractPreferredName(user);
  const weatherSummary = toWeatherSummaryText(weather, input.language);
  const headlineSummary = toHeadlineSummaryText(headline, input.language);

  let greeting;
  try {
    greeting = await generateGreetingText(
      {
        artistId: input.artistId,
        language: input.language,
        dateLabel,
        timeLabel,
        preferredName,
        horoscopeSign: userHoroscope,
        weatherSummary,
        headlineSummary,
        variationCue: buildGreetingVariationCue(input.language),
        includeVoiceHint: input.includeVoiceHint,
        availableModes: input.availableModes
      }
    );
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Greeting generator unavailable.';
    sendError(res, 502, message, { code: 'UPSTREAM_ERROR', requestId });
    return;
  }

  res.status(200).json({ greeting });
};
