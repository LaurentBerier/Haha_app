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

  return {
    artistId,
    language: normalizeLanguage(body.language),
    coords: parseCoords(body.coords)
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

function buildGreetingSystemPrompt(language) {
  const isEnglish = language.toLowerCase().startsWith('en');
  if (isEnglish) {
    return `You are Cathy Gauthier welcoming the user to mode selection.
Write 4 to 6 short sentences.
Ask how they are doing, mention the current weather and one real headline, then propose the available chat modes.
Keep a warm, witty Cathy voice. Use proper punctuation and accents when relevant.
Do not use markdown, asterisks, bullet lists, or em dashes.`;
  }

  return `Tu es Cathy Gauthier qui accueille l'utilisateur sur l'ecran de selection de mode.
Ecris 4 a 6 phrases courtes.
Demande comment il va, mentionne la meteo actuelle et une vraie manchette du jour, puis propose les modes disponibles.
Garde un ton chaleureux et punchy, style Cathy, avec de bons accents.
N'utilise pas de markdown, pas d'asterisque, pas de liste, pas de tiret long.`;
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
      'Available modes: chat, roast, impro, horoscope, personalized message, image-based modes.'
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
    'Modes disponibles: discussion, roast, impro, horoscope, message personnalise, modes image.'
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
        max_tokens: 260,
        temperature: 0.8,
        stream: false,
        system: buildGreetingSystemPrompt(context.language),
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

    return clampToSentenceLimit(rawText, 6);
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
  const preferredName = extractPreferredName(user);
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
        headlineSummary
      }
    );
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Greeting generator unavailable.';
    sendError(res, 502, message, { code: 'UPSTREAM_ERROR', requestId });
    return;
  }

  res.status(200).json({ greeting });
};
