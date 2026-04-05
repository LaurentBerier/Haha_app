const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const IP_API_URL = 'https://ipapi.co';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;
const DEFAULT_OVERLOAD_RETRY_AFTER_SECONDS = 3;
const DEFAULT_WEATHER_TIMEOUT_MS = 4_500;
const DEFAULT_NEWS_TIMEOUT_MS = 4_500;
const DEFAULT_IP_GEO_TIMEOUT_MS = 4_500;
const WEATHER_CACHE_TTL_MS = 10 * 60_000;
const MAX_WEATHER_CACHE_ENTRIES = 200;
const NEWS_CACHE_TTL_MS = 30 * 60_000;
const MAX_RSS_ITEMS_PER_FEED = 14;
const MAX_NEWS_SIGNALS_PER_REGION = 3;
const TUTORIAL_CONNECTION_LIMIT = 3;
const TUTORIAL_NUDGE_AFTER_USER_MESSAGES = 2;
const DEFAULT_HEADLINE_INCLUSION_RATE = 0.3;
const MODE_INTRO_TYPE = 'mode_intro';
const DEFAULT_INTRO_TYPE = 'greeting';
const MODE_ID_ON_JASE = 'on-jase';
const MODE_ID_GRILL = 'grill';
const MODE_ID_MEME_GENERATOR = 'meme-generator';
const TRANSIENT_UPSTREAM_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

const RSS_FEEDS = [
  {
    id: 'radio-canada',
    name: 'Radio-Canada',
    url: 'https://ici.radio-canada.ca/rss/4159'
  },
  {
    id: 'lapresse',
    name: 'La Presse',
    url: 'https://www.lapresse.ca/actualites/rss.xml'
  },
  {
    id: 'tva-nouvelles',
    name: 'TVA Nouvelles',
    url: 'https://www.tvanouvelles.ca/rss.xml'
  }
];

const weatherCache = new Map();
let newsSignalsCache = {
  value: null,
  expiresAt: 0
};
let profileSelectSupportsTutorialCounterColumn = true;
let profileUpdateSupportsTutorialCounterColumn = true;

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

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanEnv(value, fallback = false) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseProbability(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }

  return parsed;
}

function parseRetryAfterSeconds(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return null;
  }

  const asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt) && asInt > 0) {
    return asInt;
  }

  const asDateMs = Date.parse(raw);
  if (!Number.isFinite(asDateMs)) {
    return null;
  }

  const deltaSeconds = Math.ceil((asDateMs - Date.now()) / 1000);
  return deltaSeconds > 0 ? deltaSeconds : null;
}

function getErrorStatus(error) {
  if (!isRecord(error)) {
    return null;
  }

  const parsed = Number.parseInt(String(error.status ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getErrorRetryAfterSeconds(error) {
  if (!isRecord(error)) {
    return null;
  }

  if (Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds > 0) {
    return Math.ceil(error.retryAfterSeconds);
  }

  if (typeof error.retryAfter === 'string') {
    return parseRetryAfterSeconds(error.retryAfter);
  }

  return null;
}

function isTransientUpstreamOverload(error) {
  const status = getErrorStatus(error);
  if (Number.isFinite(status) && TRANSIENT_UPSTREAM_STATUSES.has(status)) {
    return true;
  }

  if (!isRecord(error)) {
    return false;
  }

  const code = normalizeText(error.code).toLowerCase();
  if (code.includes('overload')) {
    return true;
  }

  const message = normalizeText(error.message).toLowerCase();
  return message.includes('overloaded') || message.includes('overload');
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1'
      }
    });
    const payload = await response.text();
    return { response, payload };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function normalizeLanguage(value) {
  if (typeof value !== 'string') {
    return 'fr-CA';
  }

  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('en') ? 'en-CA' : 'fr-CA';
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

function classifyGreetingNameStyle(preferredName) {
  const normalized = normalizeOptionalString(preferredName, 40);
  if (!normalized) {
    return 'normal';
  }

  const compact = normalized.replace(/\s+/g, '');
  if (compact.length >= 15) {
    return 'unusual';
  }

  if (/\d/.test(compact)) {
    return 'unusual';
  }

  if (/[^A-Za-zÀ-ÖØ-öø-ÿ'’\- ]/.test(normalized)) {
    return 'unusual';
  }

  if (/(.)\1\1/i.test(compact)) {
    return 'unusual';
  }

  const lettersOnly = compact.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
  if (lettersOnly.length >= 4) {
    const upperCount = (lettersOnly.match(/[A-ZÀ-ÖØ-Þ]/g) ?? []).length;
    const lowerCount = (lettersOnly.match(/[a-zà-öø-ÿ]/g) ?? []).length;
    const hasAggressiveMixedCase =
      /[a-zà-öø-ÿ][A-ZÀ-ÖØ-Þ]/.test(lettersOnly) || /[A-ZÀ-ÖØ-Þ]{2,}[a-zà-öø-ÿ]/.test(lettersOnly);
    if (upperCount > 0 && lowerCount > 0 && (hasAggressiveMixedCase || upperCount >= Math.ceil(lettersOnly.length * 0.6))) {
      return 'unusual';
    }
  }

  return 'normal';
}

function toCacheCoordinate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 1000) / 1000;
}

function toWeatherCacheKey(coords) {
  const lat = toCacheCoordinate(coords?.lat);
  const lon = toCacheCoordinate(coords?.lon);
  if (lat === null || lon === null) {
    return null;
  }

  return `${lat.toFixed(3)}:${lon.toFixed(3)}`;
}

function getWeatherCacheEntry(cacheKey, nowTs) {
  if (!cacheKey) {
    return { fresh: null, stale: null };
  }

  const entry = weatherCache.get(cacheKey) ?? null;
  if (!entry) {
    return { fresh: null, stale: null };
  }

  if (entry.expiresAt > nowTs) {
    return { fresh: entry.value, stale: entry.value };
  }

  return { fresh: null, stale: entry.value };
}

function compactWeatherCache(nowTs) {
  for (const [key, entry] of weatherCache.entries()) {
    if (!entry || entry.expiresAt <= nowTs - WEATHER_CACHE_TTL_MS) {
      weatherCache.delete(key);
    }
  }

  if (weatherCache.size <= MAX_WEATHER_CACHE_ENTRIES) {
    return;
  }

  const keys = Array.from(weatherCache.keys());
  const overflow = weatherCache.size - MAX_WEATHER_CACHE_ENTRIES;
  for (let index = 0; index < overflow; index += 1) {
    const key = keys[index];
    if (typeof key === 'string') {
      weatherCache.delete(key);
    }
  }
}

function setWeatherCacheEntry(cacheKey, value, nowTs) {
  if (!cacheKey || !value) {
    return;
  }

  weatherCache.set(cacheKey, {
    value,
    expiresAt: nowTs + WEATHER_CACHE_TTL_MS
  });
  compactWeatherCache(nowTs);
}

function describeOpenMeteoWeatherCode(code, language) {
  const isEnglish = language.toLowerCase().startsWith('en');
  const labels = {
    0: isEnglish ? 'clear sky' : 'ciel dégagé',
    1: isEnglish ? 'mostly clear' : 'plutôt dégagé',
    2: isEnglish ? 'partly cloudy' : 'partiellement nuageux',
    3: isEnglish ? 'overcast' : 'couvert',
    45: isEnglish ? 'foggy' : 'brouillard',
    48: isEnglish ? 'freezing fog' : 'brouillard givrant',
    51: isEnglish ? 'light drizzle' : 'bruine légère',
    53: isEnglish ? 'drizzle' : 'bruine',
    55: isEnglish ? 'heavy drizzle' : 'bruine forte',
    56: isEnglish ? 'light freezing drizzle' : 'bruine verglaçante légère',
    57: isEnglish ? 'freezing drizzle' : 'bruine verglaçante',
    61: isEnglish ? 'light rain' : 'pluie légère',
    63: isEnglish ? 'rain' : 'pluie',
    65: isEnglish ? 'heavy rain' : 'forte pluie',
    66: isEnglish ? 'light freezing rain' : 'pluie verglaçante légère',
    67: isEnglish ? 'freezing rain' : 'pluie verglaçante',
    71: isEnglish ? 'light snow' : 'neige légère',
    73: isEnglish ? 'snow' : 'neige',
    75: isEnglish ? 'heavy snow' : 'forte neige',
    77: isEnglish ? 'snow grains' : 'grains de neige',
    80: isEnglish ? 'light rain showers' : 'averses légères',
    81: isEnglish ? 'rain showers' : 'averses',
    82: isEnglish ? 'heavy rain showers' : 'fortes averses',
    85: isEnglish ? 'light snow showers' : 'averses de neige légères',
    86: isEnglish ? 'snow showers' : 'averses de neige',
    95: isEnglish ? 'thunderstorm' : 'orage',
    96: isEnglish ? 'thunderstorm with light hail' : 'orage avec faible grêle',
    99: isEnglish ? 'thunderstorm with hail' : 'orage avec grêle'
  };

  return labels[code] ?? (isEnglish ? 'weather variable' : 'météo variable');
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

function normalizeIntroType(value) {
  if (typeof value !== 'string') {
    return DEFAULT_INTRO_TYPE;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_INTRO_TYPE;
  }
  if (normalized === MODE_INTRO_TYPE) {
    return MODE_INTRO_TYPE;
  }
  if (normalized === DEFAULT_INTRO_TYPE) {
    return DEFAULT_INTRO_TYPE;
  }

  throw new Error(`introType "${value}" is not supported.`);
}

function normalizeModeId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return normalized;
}

function parsePayload(body) {
  if (!isRecord(body)) {
    throw new Error('JSON body is required.');
  }

  const artistId = typeof body.artistId === 'string' ? body.artistId.trim() : '';
  if (!artistId) {
    throw new Error('artistId is required.');
  }
  const introType = normalizeIntroType(body.introType);
  const modeId = normalizeModeId(body.modeId);
  if (introType === MODE_INTRO_TYPE && !modeId) {
    throw new Error('modeId is required when introType is mode_intro.');
  }
  if (
    introType === MODE_INTRO_TYPE &&
    modeId !== MODE_ID_ON_JASE &&
    modeId !== MODE_ID_GRILL &&
    modeId !== MODE_ID_MEME_GENERATOR
  ) {
    throw new Error(`modeId "${modeId}" is not supported for mode_intro.`);
  }

  const isSessionFirstGreeting = body.isSessionFirstGreeting === true;
  const availableModes = Array.isArray(body.availableModes)
    ? body.availableModes
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 12)
        .map((entry) => entry.slice(0, 60))
    : [];

  const memoryFacts = Array.isArray(body.memoryFacts)
    ? body.memoryFacts
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 6)
        .map((entry) => entry.slice(0, 140))
    : [];
  const recentActivityFacts = Array.isArray(body.recentActivityFacts)
    ? body.recentActivityFacts
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 2)
        .map((entry) => entry.slice(0, 140))
    : [];
  const askActivityFeedback = body.askActivityFeedback === true;
  const recentExperienceName = normalizeOptionalString(body.recentExperienceName, 80);
  const recentExperienceType =
    body.recentExperienceType === 'mode' || body.recentExperienceType === 'game' ? body.recentExperienceType : null;
  const activityFeedbackCue = normalizeOptionalString(body.activityFeedbackCue, 180);
  const lastGreetingSnippet = normalizeOptionalString(body.lastGreetingSnippet, 180);

  return {
    artistId,
    language: normalizeLanguage(body.language),
    introType,
    modeId,
    coords: parseCoords(body.coords),
    isSessionFirstGreeting,
    availableModes,
    preferredName: normalizeOptionalString(body.preferredName, 40),
    memoryFacts,
    recentActivityFacts,
    askActivityFeedback,
    recentExperienceName,
    recentExperienceType,
    activityFeedbackCue,
    lastGreetingSnippet
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
  const geoTimeoutMs = parsePositiveInt(process.env.GREETING_IP_TIMEOUT_MS, DEFAULT_IP_GEO_TIMEOUT_MS);
  const endpoint = clientIp
    ? `${IP_API_URL}/${encodeURIComponent(clientIp)}/json/`
    : `${IP_API_URL}/json/`;

  try {
    const { response, payload } = await fetchJsonWithTimeout(endpoint, geoTimeoutMs);
    if (!response.ok) {
      return null;
    }

    const lat = typeof payload.latitude === 'number' && Number.isFinite(payload.latitude) ? payload.latitude : null;
    const lon = typeof payload.longitude === 'number' && Number.isFinite(payload.longitude) ? payload.longitude : null;
    if (lat === null || lon === null) {
      return null;
    }

    return {
      lat,
      lon,
      city: normalizeOptionalString(payload.city, 80),
      countryCode: normalizeOptionalString(payload.country_code, 4)
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

  const nowTs = Date.now();
  const cacheKey = toWeatherCacheKey(coords);
  const { fresh, stale } = getWeatherCacheEntry(cacheKey, nowTs);
  if (fresh) {
    return fresh;
  }

  const weatherTimeoutMs = parsePositiveInt(process.env.GREETING_WEATHER_TIMEOUT_MS, DEFAULT_WEATHER_TIMEOUT_MS);
  const endpoint = new URL(OPEN_METEO_FORECAST_URL);
  endpoint.searchParams.set('latitude', String(coords.lat));
  endpoint.searchParams.set('longitude', String(coords.lon));
  endpoint.searchParams.set('timezone', 'auto');
  endpoint.searchParams.set('forecast_days', '1');
  endpoint.searchParams.set('current', 'temperature_2m,weather_code');
  endpoint.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code');

  try {
    const { response, payload } = await fetchJsonWithTimeout(endpoint.toString(), weatherTimeoutMs);
    if (!response.ok) {
      return stale;
    }

    const currentTemperatureRaw =
      isRecord(payload.current) && typeof payload.current.temperature_2m === 'number' && Number.isFinite(payload.current.temperature_2m)
        ? payload.current.temperature_2m
        : null;
    const currentCodeRaw =
      isRecord(payload.current) && typeof payload.current.weather_code === 'number' && Number.isFinite(payload.current.weather_code)
        ? payload.current.weather_code
        : null;
    const maxArray =
      isRecord(payload.daily) && Array.isArray(payload.daily.temperature_2m_max) ? payload.daily.temperature_2m_max : null;
    const minArray =
      isRecord(payload.daily) && Array.isArray(payload.daily.temperature_2m_min) ? payload.daily.temperature_2m_min : null;
    const codeArray = isRecord(payload.daily) && Array.isArray(payload.daily.weather_code) ? payload.daily.weather_code : null;
    const dailyMaxRaw = typeof maxArray?.[0] === 'number' && Number.isFinite(maxArray[0]) ? maxArray[0] : null;
    const dailyMinRaw = typeof minArray?.[0] === 'number' && Number.isFinite(minArray[0]) ? minArray[0] : null;
    const dailyCodeRaw = typeof codeArray?.[0] === 'number' && Number.isFinite(codeArray[0]) ? codeArray[0] : null;

    const temperatureCelsius = currentTemperatureRaw === null ? null : Math.round(currentTemperatureRaw);
    const maxTemperatureCelsius = dailyMaxRaw === null ? null : Math.round(dailyMaxRaw);
    const minTemperatureCelsius = dailyMinRaw === null ? null : Math.round(dailyMinRaw);
    const weatherCode = currentCodeRaw ?? dailyCodeRaw;
    const description = weatherCode === null ? null : describeOpenMeteoWeatherCode(weatherCode, language);
    const city = coords.city ?? null;
    const countryCode = coords.countryCode ?? null;

    if (temperatureCelsius === null && maxTemperatureCelsius === null && minTemperatureCelsius === null && !description && !city) {
      return stale;
    }

    const weather = {
      temperatureCelsius,
      maxTemperatureCelsius,
      minTemperatureCelsius,
      description: normalizeOptionalString(description, 80),
      city,
      countryCode
    };

    setWeatherCacheEntry(cacheKey, weather, nowTs);
    return weather;
  } catch (error) {
    console.error(`[api/greeting][${requestId}] Weather lookup failed`, error);
    return stale;
  }
}

function decodeXmlEntities(value) {
  if (typeof value !== 'string' || !value) {
    return '';
  }

  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&#(\d+);/g, (_match, num) => {
      const codePoint = Number.parseInt(num, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
    });
}

function stripHtmlTags(value) {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  return value.replace(/<[^>]+>/g, ' ');
}

function normalizeHeadlineText(value, maxLength = 200) {
  const decoded = decodeXmlEntities(value);
  const stripped = stripHtmlTags(decoded);
  const compact = stripped.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return null;
  }

  return compact.slice(0, maxLength);
}

function extractXmlTagValue(xmlBlock, tagName) {
  if (typeof xmlBlock !== 'string' || !xmlBlock) {
    return null;
  }

  const pattern = new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xmlBlock.match(pattern);
  if (!match || typeof match[1] !== 'string') {
    return null;
  }

  return match[1];
}

function parseNewsTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return 0;
  }

  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

const QUEBEC_NEWS_KEYWORDS = [
  'québec',
  'quebec',
  'montréal',
  'montreal',
  'laval',
  'gatineau',
  'saguenay',
  'trois-rivières',
  'estrie',
  'bas-saint-laurent',
  'capitale-nationale'
];

const CANADA_NEWS_KEYWORDS = [
  'canada',
  'ottawa',
  'trudeau',
  'fédéral',
  'federal',
  'toronto',
  'vancouver',
  'alberta',
  'ontario',
  'manitoba',
  'saskatchewan',
  'colombie-britannique',
  'nouvelle-écosse',
  'newfoundland'
];

const INTERNATIONAL_NEWS_KEYWORDS = [
  'international',
  'monde',
  'world',
  'états-unis',
  'etats-unis',
  'usa',
  'washington',
  'europe',
  'asie',
  'afrique',
  'ukraine',
  'russie',
  'russia',
  'chine',
  'china',
  'gaza',
  'israël',
  'israel',
  'onu',
  'otan',
  'nato'
];

function hasKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function classifyNewsRegion(headline) {
  const normalized = headline.toLowerCase();
  if (hasKeyword(normalized, INTERNATIONAL_NEWS_KEYWORDS)) {
    return 'international';
  }
  if (hasKeyword(normalized, QUEBEC_NEWS_KEYWORDS)) {
    return 'quebec';
  }
  if (hasKeyword(normalized, CANADA_NEWS_KEYWORDS)) {
    return 'canada';
  }
  return 'canada';
}

function parseRssFeedItems(xml, source) {
  if (typeof xml !== 'string' || !xml.trim()) {
    return [];
  }

  const items = [];
  const itemRegex = /<item\b[\s\S]*?<\/item>/gi;
  let match = itemRegex.exec(xml);

  while (match && items.length < MAX_RSS_ITEMS_PER_FEED) {
    const block = match[0];
    const titleRaw = extractXmlTagValue(block, 'title');
    const linkRaw = extractXmlTagValue(block, 'link');
    const pubDateRaw = extractXmlTagValue(block, 'pubDate');
    const headline = normalizeHeadlineText(titleRaw, 200);
    const link = normalizeHeadlineText(linkRaw, 300);
    if (headline) {
      const publishedAtMs = parseNewsTimestamp(pubDateRaw ?? '');
      items.push({
        headline,
        source: source.name,
        sourceId: source.id,
        url: link,
        publishedAt: publishedAtMs > 0 ? new Date(publishedAtMs).toISOString() : null,
        publishedAtMs,
        region: classifyNewsRegion(headline)
      });
    }

    match = itemRegex.exec(xml);
  }

  return items;
}

function normalizeHeadlineKey(headline) {
  return headline
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildNewsSignals(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const sorted = items
    .slice()
    .sort((left, right) => (right.publishedAtMs || 0) - (left.publishedAtMs || 0));

  const seen = new Set();
  const buckets = {
    quebec: [],
    canada: [],
    international: []
  };

  for (const item of sorted) {
    if (!item || typeof item.headline !== 'string' || !item.headline) {
      continue;
    }

    const dedupeKey = normalizeHeadlineKey(item.headline);
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const region = item.region === 'international' || item.region === 'quebec' ? item.region : 'canada';
    const target = buckets[region];
    if (target.length >= MAX_NEWS_SIGNALS_PER_REGION) {
      continue;
    }

    target.push({
      headline: item.headline,
      source: item.source,
      url: item.url ?? null,
      publishedAt: item.publishedAt ?? null
    });
  }

  const primary =
    buckets.quebec[0] ??
    buckets.canada[0] ??
    buckets.international[0] ??
    null;

  if (!primary) {
    return null;
  }

  return {
    generatedAt: new Date().toISOString(),
    primary,
    buckets
  };
}

function getNewsSignalsFromCache(nowTs) {
  const cacheValue = newsSignalsCache?.value ?? null;
  if (!cacheValue) {
    return { fresh: null, stale: null };
  }

  if (typeof newsSignalsCache.expiresAt === 'number' && newsSignalsCache.expiresAt > nowTs) {
    return { fresh: cacheValue, stale: cacheValue };
  }

  return { fresh: null, stale: cacheValue };
}

function setNewsSignalsCache(value, nowTs) {
  if (!value) {
    return;
  }

  newsSignalsCache = {
    value,
    expiresAt: nowTs + NEWS_CACHE_TTL_MS
  };
}

async function fetchNewsSignals(requestId) {
  const nowTs = Date.now();
  const { fresh, stale } = getNewsSignalsFromCache(nowTs);
  if (fresh) {
    return fresh;
  }

  const rssTimeoutMs = parsePositiveInt(process.env.GREETING_NEWS_TIMEOUT_MS, DEFAULT_NEWS_TIMEOUT_MS);
  const feedResults = await Promise.all(
    RSS_FEEDS.map(async (feed) => {
      try {
        const { response, payload } = await fetchTextWithTimeout(feed.url, rssTimeoutMs);
        if (!response.ok) {
          return [];
        }
        return parseRssFeedItems(payload, feed);
      } catch (error) {
        console.error(`[api/greeting][${requestId}] RSS fetch failed for ${feed.id}`, error);
        return [];
      }
    })
  );

  const allItems = feedResults.flat();
  const signals = buildNewsSignals(allItems);
  if (!signals) {
    return stale;
  }

  setNewsSignalsCache(signals, nowTs);
  return signals;
}

function isGreetingTutorialCounterColumnMissingError(error) {
  if (!isRecord(error)) {
    return false;
  }

  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  const details = typeof error.details === 'string' ? error.details.toLowerCase() : '';
  const hint = typeof error.hint === 'string' ? error.hint.toLowerCase() : '';
  const merged = `${message} ${details} ${hint}`;
  return (
    code === '42703' &&
    merged.includes('greeting_tutorial_sessions_count')
  );
}

function createTutorialState({
  isSessionFirstGreeting,
  persistedCount,
  hasPersistedCounter
}) {
  const safePersistedCount =
    typeof persistedCount === 'number' && Number.isFinite(persistedCount)
      ? Math.max(0, Math.floor(persistedCount))
      : 0;
  const active = isSessionFirstGreeting && (hasPersistedCounter ? safePersistedCount < TUTORIAL_CONNECTION_LIMIT : true);
  const nextCountIfIncremented = isSessionFirstGreeting
    ? hasPersistedCounter
      ? Math.min(TUTORIAL_CONNECTION_LIMIT, safePersistedCount + 1)
      : 1
    : safePersistedCount;
  const sessionIndex = active
    ? nextCountIfIncremented
    : Math.min(TUTORIAL_CONNECTION_LIMIT, safePersistedCount);

  return {
    active,
    sessionIndex,
    connectionLimit: TUTORIAL_CONNECTION_LIMIT,
    modeNudgeAfterUserMessages: TUTORIAL_NUDGE_AFTER_USER_MESSAGES,
    nextPersistedCount: nextCountIfIncremented
  };
}

async function fetchUserGreetingProfile(supabaseAdmin, userId, requestId) {
  try {
    let columns = profileSelectSupportsTutorialCounterColumn
      ? 'horoscope_sign, greeting_tutorial_sessions_count'
      : 'horoscope_sign';

    let result = await supabaseAdmin
      .from('profiles')
      .select(columns)
      .eq('id', userId)
      .maybeSingle();

    if (
      result.error &&
      profileSelectSupportsTutorialCounterColumn &&
      isGreetingTutorialCounterColumnMissingError(result.error)
    ) {
      profileSelectSupportsTutorialCounterColumn = false;
      columns = 'horoscope_sign';
      result = await supabaseAdmin
        .from('profiles')
        .select(columns)
        .eq('id', userId)
        .maybeSingle();
    }

    if (result.error) {
      console.error(`[api/greeting][${requestId}] Failed to read user profile`, result.error);
      return {
        horoscopeSign: null,
        tutorialSessionsCount: null,
        hasPersistedCounter: false
      };
    }

    const row = isRecord(result.data) ? result.data : {};
    const tutorialSessionsCount =
      profileSelectSupportsTutorialCounterColumn &&
      typeof row.greeting_tutorial_sessions_count === 'number' &&
      Number.isFinite(row.greeting_tutorial_sessions_count)
        ? Math.max(0, Math.floor(row.greeting_tutorial_sessions_count))
        : 0;

    return {
      horoscopeSign: normalizeOptionalString(row.horoscope_sign, 30),
      tutorialSessionsCount,
      hasPersistedCounter: profileSelectSupportsTutorialCounterColumn
    };
  } catch (error) {
    console.error(`[api/greeting][${requestId}] Failed to read user profile`, error);
    return {
      horoscopeSign: null,
      tutorialSessionsCount: null,
      hasPersistedCounter: false
    };
  }
}

async function incrementTutorialSessionCountIfNeeded(supabaseAdmin, userId, count, requestId) {
  if (!profileUpdateSupportsTutorialCounterColumn) {
    return false;
  }

  try {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        greeting_tutorial_sessions_count: Math.max(0, Math.floor(count))
      })
      .eq('id', userId);

    if (!error) {
      return true;
    }

    if (isGreetingTutorialCounterColumnMissingError(error)) {
      profileUpdateSupportsTutorialCounterColumn = false;
      return false;
    }

    console.error(`[api/greeting][${requestId}] Failed to update tutorial counter`, error);
    return false;
  } catch (error) {
    console.error(`[api/greeting][${requestId}] Failed to update tutorial counter`, error);
    return false;
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
  const rangeText =
    typeof weather.minTemperatureCelsius === 'number' && typeof weather.maxTemperatureCelsius === 'number'
      ? isEnglish
        ? `today ${weather.minTemperatureCelsius} to ${weather.maxTemperatureCelsius}°C`
        : `aujourd'hui ${weather.minTemperatureCelsius} a ${weather.maxTemperatureCelsius}°C`
      : null;
  const descriptionText = normalizeOptionalString(weather.description, 80);
  const cityText = [weather.city, weather.countryCode].filter(Boolean).join(', ');
  const parts = [temperatureText, rangeText, descriptionText, cityText].filter(Boolean);

  return parts.length > 0 ? parts.join(' - ') : isEnglish ? 'Weather unavailable' : 'Meteo indisponible';
}

function toHeadlineSummaryText(newsSignals, language) {
  const isEnglish = language.toLowerCase().startsWith('en');
  const fallback = isEnglish ? 'No headline available' : 'Aucune manchette disponible';

  if (!isRecord(newsSignals)) {
    return fallback;
  }

  const buckets = isRecord(newsSignals.buckets) ? newsSignals.buckets : {};
  const quebecTop = Array.isArray(buckets.quebec) ? buckets.quebec[0] : null;
  const canadaTop = Array.isArray(buckets.canada) ? buckets.canada[0] : null;
  const internationalTop = Array.isArray(buckets.international) ? buckets.international[0] : null;

  const parts = [];
  if (isRecord(quebecTop) && typeof quebecTop.headline === 'string') {
    parts.push(`${isEnglish ? 'Quebec' : 'Québec'}: ${quebecTop.headline}`);
  }
  if (isRecord(canadaTop) && typeof canadaTop.headline === 'string') {
    parts.push(`${isEnglish ? 'Canada' : 'Canada'}: ${canadaTop.headline}`);
  }
  if (isRecord(internationalTop) && typeof internationalTop.headline === 'string') {
    parts.push(`${isEnglish ? 'International' : 'International'}: ${internationalTop.headline}`);
  }

  if (parts.length > 0) {
    return normalizeOptionalString(parts.join(' | '), 420) ?? fallback;
  }

  const primary = isRecord(newsSignals.primary) && typeof newsSignals.primary.headline === 'string'
    ? normalizeOptionalString(newsSignals.primary.headline, 220)
    : null;
  return primary ?? fallback;
}

function buildGreetingSystemPrompt(language, options = {}) {
  const isEnglish = language.toLowerCase().startsWith('en');
  const tutorialActive = options.tutorialActive === true;

  if (tutorialActive && isEnglish) {
    return `You are Cathy Gauthier, intense, playful, sarcastic, welcoming the user in mode selection.
Write exactly 3 short sentences in this strict order:
1) Greet the user by first name when available, ask how they are doing, and add a short playful joke about being Cathy's clone (funny but kind).
2) Explain that voice conversation is already active and the lit mic at the bottom-right is how they talk to you directly right now.
3) Explain that if they prefer typing, they can tap the mic to return to text mode, then end with one easy first prompt.
Hard rules:
- During tutorial, do NOT introduce weather, headlines, or mode lists unless the user explicitly asks.
- If Name style is unusual, add one short positive acknowledgment about the name (playful, never mocking).
- Never write "how are you with Cathy" or similar unnatural phrasing.
- Avoid opening with "Ah là", "Allô", or equivalent intros; use "Hey", "Salut", or start directly.
- Self-deprecating humor is allowed, but never imply your jokes are bad, lame, or flat.
- Tone must feel welcoming and confidence-building for onboarding.
- Humor should be witty and light, never mean in this greeting.
- Keep spoken-style contractions and lively oral rhythm.
- Include one brief emotional cue naturally (laugh, excitement, or sarcasm), without overdoing it.
- Keep it natural, coherent, and concise.
- The 3 sentences must flow as one smooth mini welcome arc.
- No markdown, no bullets, no asterisks, no em dashes.
- Keep proper punctuation and contractions.
- 30 to 60 words total.`;
  }

  if (tutorialActive) {
    return `Tu es Cathy Gauthier, intense, excitée, sarcastique et drôle, et tu accueilles l'utilisateur dans l'ecran de selection de mode.
Ecris exactement 3 phrases courtes, dans cet ordre strict :
1) Salue la personne par son prenom si disponible, demande comment elle va, et ajoute une mini blague sur le fait que tu es le clone de Cathy (drôle, vive, mais bienveillante).
2) Explique que la conversation vocale est déjà active et que le micro allumé en bas à droite sert à lui parler direct.
3) Explique que si la personne prefere texter, elle peut cliquer sur le micro pour retourner en mode texte, puis termine avec une invitation facile.
Regles absolues :
- Pendant le tutorial, n'introduis JAMAIS meteo, actualite ou liste de modes sauf si l'utilisateur le demande explicitement.
- Si le style du prenom est inhabituel, ajoute un clin d'oeil positif bref sur le prenom (jamais moqueur).
- Interdit de dire "comment tu vas avec Cathy" ou une tournure equivalente.
- Evite d'ouvrir avec "Ah la", "Allo" ou equivalent; privilegie "Hey", "Salut" ou une entree directe.
- L'autoderision est permise, mais jamais en disant ou insinuant que tes blagues sont nulles, plates ou mauvaises.
- Ton d'accueil onboarding: chaleureux, complice, rassurant, energique.
- Humour d'entree: taquin, jamais agressif dans ce message d'accueil.
- Le texte doit etre logique, naturel et court en francais quebecois parle.
- Utilise des contractions orales quebecoises fortes (ex: j'suis, t'es, t'as, y'a, j'peux, j'vais, t'tente, t'veux, t'peux, s'pas, c'est-tu, han). Elision obligatoire : "te" -> "t'" devant consonne (t'tente, t'vois, t'penses), "tu" -> "t'" dans les questions (t'as-tu, t'veux-tu). Pas de "te" isole apres verbe quand l'elision est naturelle.
- Ajoute un micro-signal d'emotion (rire, excitation ou sarcasme) de facon naturelle.
- Les 3 phrases doivent s'enchainer de facon fluide comme un mini accueil.
- Pas de markdown, pas d'asterisque, pas de liste, pas de tiret long.
- Orthographe et ponctuation impeccables (accents et apostrophes obligatoires).
- 30 a 60 mots au total.`;
  }

  if (isEnglish) {
    return `You are Cathy Gauthier, intense, sarcastic, and funny Quebec comedian.
Reconnect quickly like a close friend after a few days: warm, sharp, playful.
Write exactly 2 to 3 short sentences (20 to 45 words total).
Hard rules:
- Greet by first name when available, then move fast.
- End with one lively invitation to continue.
- Humor is mandatory: playful, sarcastic, natural, never scripted.
- Weather is optional: mention it only if it genuinely helps the joke or warmth.
- Headlines are optional and rare: mention one only if "Headline context available" is "yes" and it is truly relevant/funny.
- If "Headline context available" is "no", do not mention headlines.
- If you have recent facts about the person, weave one in naturally.
- If "Recent activity facts" is not "none", mention one of those activity facts naturally.
- If "Recent experience name" is provided, explicitly name that exact mode/game once in your greeting.
- If "Ask activity feedback" is "yes", include one short question asking whether they liked it.
- If "Activity feedback cue" is provided and feedback is requested, align your question to that cue.
- If "Previous greeting snippet" is provided, avoid repeating that same wording.
- No forced "Cathy's clone" joke.
- Never write "how are you with Cathy" or similar unnatural phrasing.
- Avoid opening with "Ah là", "Allô", or equivalent intros; use "Hey", "Hi", or start directly.
- Self-deprecating humor is allowed, but never imply your jokes are bad, lame, or flat.
- Keep spoken-style contractions and lively oral rhythm.
- One brief emotional cue is enough.
- No markdown, no bullets, no asterisks, no em dashes.
- Keep proper punctuation and contractions.`;
  }

  return `Tu es Cathy Gauthier, humoriste québécoise intense, sarcastique et drôle.
Reprends contact rapidement comme une proche après quelques jours: chaleureux, incisif, drôle.
Écris exactement 2 à 3 phrases courtes (20 à 45 mots au total).
Règles absolues :
- Salue par le prénom si disponible, puis va droit au but.
- Termine avec une invitation vivante pour relancer l'échange.
- Humour obligatoire : taquin, sarcastique, naturel, jamais scripté.
- La météo est optionnelle : utilise-la seulement si ça ajoute vraiment quelque chose.
- Les manchettes sont optionnelles et rares : n'en parle que si "Contexte manchette disponible" est "oui" et que c'est pertinent/drôle.
- Si "Contexte manchette disponible" est "non", ne parle pas des nouvelles.
- Si tu as une info récente sur la personne, glisse-en une naturellement.
- Si "Contexte activite recente" n'est pas "aucun", mentionne naturellement un de ces elements.
- Si "Nom experience recente" est fourni, nomme explicitement ce mode/jeu exact une fois dans ton greeting.
- Si "Demander feedback activite" est "oui", ajoute une question courte pour savoir si la personne a aime ca.
- Si "Cue feedback activite" est fourni et que le feedback est demande, aligne ta question sur ce cue.
- Si "Extrait dernier greeting" est fourni, evite de reutiliser la meme formulation.
- Pas de blague forcée sur le clone de Cathy.
- Interdit de dire "comment tu vas avec Cathy" ou une tournure équivalente.
- Évite d'ouvrir avec "Ah là", "Allô" ou équivalent ; privilégie "Hey", "Salut" ou une entrée directe.
- L'autodérision est permise, mais jamais en disant ou insinuant que tes blagues sont nulles, plates ou mauvaises.
- Le texte doit être logique, naturel et court en français québécois parlé.
- Contractions orales québécoises fortes (j'suis, t'es, t'as, y'a, j'peux, j'vais, c'est-tu, han, etc.). Élision naturelle attendue.
- Un seul micro-signal d'émotion naturel.
- Pas de markdown, pas d'astérisque, pas de liste, pas de tiret long.
- Orthographe et ponctuation impeccables (accents et apostrophes obligatoires).`;
}

function buildGreetingVariationCue(language) {
  const isEnglish = language.toLowerCase().startsWith('en');
  const englishCues = ['explosive opener', 'sarcastic wink', 'playful laugh beat'];
  const frenchCues = ['entree explosive', 'sarcasme complice', 'petit rire nerveux'];
  const cues = isEnglish ? englishCues : frenchCues;
  const index = Math.floor(Math.random() * cues.length);
  return cues[index] ?? cues[0];
}

function buildModeIntroVariationCue(language, modeId) {
  const isEnglish = language.toLowerCase().startsWith('en');
  const englishByMode = {
    [MODE_ID_ON_JASE]: ['blunt coach energy', 'complicit reality check', 'direct wake-up call'],
    [MODE_ID_GRILL]: ['playful fire', 'sharp roast setup', 'high-voltage tease'],
    [MODE_ID_MEME_GENERATOR]: ['quick visual comedy', 'caption lab energy', 'shareable meme setup']
  };
  const frenchByMode = {
    [MODE_ID_ON_JASE]: ['coach cash', 'claque de realite complice', 'franchise utile'],
    [MODE_ID_GRILL]: ['feu taquin', 'setup de roast mordant', 'attaque theatrale'],
    [MODE_ID_MEME_GENERATOR]: ['atelier de caption', 'humour visuel rapide', 'mode meme partageable']
  };
  const source = isEnglish ? englishByMode : frenchByMode;
  const fallbacks = isEnglish ? ['direct opener'] : ['entree directe'];
  const cues = source[modeId] ?? fallbacks;
  const index = Math.floor(Math.random() * cues.length);
  return cues[index] ?? cues[0] ?? fallbacks[0];
}

function buildModeIntroSystemPrompt(language, modeId) {
  const isEnglish = language.toLowerCase().startsWith('en');

  if (isEnglish) {
    if (modeId === MODE_ID_MEME_GENERATOR) {
      return `You are Cathy Gauthier. You are opening the mode "Meme Generator".
Write exactly 1 to 2 short sentences, maximum 32 words total.
Required structure:
1) Start with the user's first name when available.
2) Ask them to tap the small + on the left of the text composer to upload one image now, and add a short text context because it helps make funnier memes.
Hard rules:
- No tutorial/mic instructions.
- No weather, headlines, or mode list.
- Keep it welcoming, playful, and concrete.
- If name style is unusual, add one short positive nod.
- No markdown, no bullets, no asterisks, no em dash.`;
    }

    if (modeId === MODE_ID_GRILL) {
      return `You are Cathy Gauthier. You are opening the mode "Mets-moi sur le grill".
Write exactly 2 to 3 short sentences, maximum 45 words total.
Required structure:
1) Greet the user by first name when available.
2) Explain the mode concept: sharper roast energy, still intelligent and playful.
3) End by inviting the user to talk and provide concrete details.
Hard rules:
- No tutorial/mic instructions.
- No weather, headlines, or mode list.
- Keep it welcoming but bold.
- If name style is unusual, add one short positive nod.
- No markdown, no bullets, no asterisks, no em dash.`;
    }

    return `You are Cathy Gauthier. You are opening the mode "Dis-moi la verite".
Write exactly 2 to 3 short sentences, maximum 45 words total.
Required structure:
1) Greet the user by first name when available.
2) Explain the mode concept: blunt truth plus useful coaching, no gratuitous humiliation.
3) End by inviting the user to talk and share one concrete situation.
Hard rules:
- No tutorial/mic instructions.
- No weather, headlines, or mode list.
- Keep it warm, direct, and confident.
- If name style is unusual, add one short positive nod.
- No markdown, no bullets, no asterisks, no em dash.`;
  }

  if (modeId === MODE_ID_MEME_GENERATOR) {
    return `Tu es Cathy Gauthier. Tu ouvres le mode "Generateur de Meme".
Ecris exactement 1 a 2 phrases courtes, maximum 32 mots au total.
Structure obligatoire:
1) Commence avec le prenom de la personne si disponible.
2) Demande de cliquer sur le petit + a gauche du champ texte pour uploader une image maintenant, et d'ajouter un court contexte texte car ca aide a faire des memes plus droles.
Regles absolues:
- Aucune instruction tutorial/micro.
- Pas de meteo, pas d'actualites, pas de liste de modes.
- Ton chaleureux, taquin et concret.
- Si le style du prenom est inhabituel, ajoute un clin d'oeil positif bref.
- Pas de markdown, pas de liste, pas d'asterisque, pas de tiret long.`;
  }

  if (modeId === MODE_ID_GRILL) {
    return `Tu es Cathy Gauthier. Tu ouvres le mode "Mets-moi sur le grill".
Ecris exactement 2 a 3 phrases courtes, maximum 45 mots au total.
Structure obligatoire:
1) Salue la personne par son prenom si disponible.
2) Explique le concept du mode: roast plus mordant, mais intelligent et ludique.
3) Termine par une invitation claire a parler avec des details concrets.
Regles absolues:
- Aucune instruction tutorial/micro.
- Pas de meteo, pas d'actualites, pas de liste de modes.
- Ton accueillant mais assume et energique.
- Si le style du prenom est inhabituel, ajoute un clin d'oeil positif bref.
- Pas de markdown, pas de liste, pas d'asterisque, pas de tiret long.`;
  }

  return `Tu es Cathy Gauthier. Tu ouvres le mode "Dis-moi la verite".
Ecris exactement 2 a 3 phrases courtes, maximum 45 mots au total.
Structure obligatoire:
1) Salue la personne par son prenom si disponible.
2) Explique le concept du mode: verite frontale et coaching utile, sans humiliation gratuite.
3) Termine par une invitation claire a parler d'une situation concrete.
Regles absolues:
- Aucune instruction tutorial/micro.
- Pas de meteo, pas d'actualites, pas de liste de modes.
- Ton chaleureux, direct, confiant.
- Si le style du prenom est inhabituel, ajoute un clin d'oeil positif bref.
- Pas de markdown, pas de liste, pas d'asterisque, pas de tiret long.`;
}

function buildModeIntroUserPrompt(context) {
  const isEnglish = context.language.toLowerCase().startsWith('en');

  if (isEnglish) {
    return [
      `Date: ${context.dateLabel}`,
      `Time: ${context.timeLabel}`,
      `Artist: ${context.artistId}`,
      `Mode ID: ${context.modeId}`,
      `First name: ${context.preferredName ?? 'Unknown'}`,
      `Name style: ${context.nameStyle === 'unusual' ? 'unusual' : 'normal'}`,
      `Recent facts about the person: ${context.memoryFacts && context.memoryFacts.length > 0 ? context.memoryFacts.join(' | ') : 'none'}`,
      `Variation cue: ${context.variationCue}`
    ].join('\n');
  }

  return [
    `Date: ${context.dateLabel}`,
    `Heure: ${context.timeLabel}`,
    `Artiste: ${context.artistId}`,
    `Mode ID: ${context.modeId}`,
    `Prenom: ${context.preferredName ?? 'Inconnu'}`,
    `Style du prenom: ${context.nameStyle === 'unusual' ? 'inhabituel' : 'normal'}`,
    `Contexte recents sur la personne: ${context.memoryFacts && context.memoryFacts.length > 0 ? context.memoryFacts.join(' | ') : 'aucun'}`,
    `Variation: ${context.variationCue}`
  ].join('\n');
}

function buildGreetingUserPrompt(context) {
  const isEnglish = context.language.toLowerCase().startsWith('en');
  if (isEnglish) {
    return [
      `Date: ${context.dateLabel}`,
      `Time: ${context.timeLabel}`,
      `Artist: ${context.artistId}`,
      `First name: ${context.preferredName ?? 'Unknown'}`,
      `Name style: ${context.nameStyle === 'unusual' ? 'unusual' : 'normal'}`,
      `Horoscope sign: ${context.horoscopeSign ?? 'Unknown'}`,
      `Weather: ${context.weatherSummary}`,
      `Headline: ${context.headlineSummary}`,
      `Recent facts about the person: ${context.memoryFacts && context.memoryFacts.length > 0 ? context.memoryFacts.join(' | ') : 'none'}`,
      `Recent activity facts: ${context.recentActivityFacts && context.recentActivityFacts.length > 0 ? context.recentActivityFacts.join(' | ') : 'none'}`,
      `Recent experience name: ${context.recentExperienceName ?? 'none'}`,
      `Recent experience type: ${context.recentExperienceType ?? 'none'}`,
      `Ask activity feedback: ${context.askActivityFeedback ? 'yes' : 'no'}`,
      `Activity feedback cue: ${context.activityFeedbackCue ?? 'none'}`,
      `Previous greeting snippet: ${context.lastGreetingSnippet ?? 'none'}`,
      `Available modes: ${context.availableModes.join(', ') || 'none provided'}`,
      `Variation cue: ${context.variationCue}`,
      `Headline context available: ${context.headlineContextAvailable ? 'yes' : 'no'}`,
      `Tutorial mode active: ${context.tutorialActive ? 'yes' : 'no'}`,
      `Include voice hint sentence: ${context.includeVoiceHint ? 'yes' : 'no'}`
    ].join('\n');
  }

  return [
    `Date: ${context.dateLabel}`,
    `Heure: ${context.timeLabel}`,
    `Artiste: ${context.artistId}`,
    `Prenom: ${context.preferredName ?? 'Inconnu'}`,
    `Style du prenom: ${context.nameStyle === 'unusual' ? 'inhabituel' : 'normal'}`,
    `Signe astro: ${context.horoscopeSign ?? 'Inconnu'}`,
    `Meteo: ${context.weatherSummary}`,
    `Manchette: ${context.headlineSummary}`,
    `Contexte recents sur la personne: ${context.memoryFacts && context.memoryFacts.length > 0 ? context.memoryFacts.join(' | ') : 'aucun'}`,
    `Contexte activite recente: ${context.recentActivityFacts && context.recentActivityFacts.length > 0 ? context.recentActivityFacts.join(' | ') : 'aucun'}`,
    `Nom experience recente: ${context.recentExperienceName ?? 'aucun'}`,
    `Type experience recente: ${context.recentExperienceType ?? 'aucun'}`,
    `Demander feedback activite: ${context.askActivityFeedback ? 'oui' : 'non'}`,
    `Cue feedback activite: ${context.activityFeedbackCue ?? 'aucun'}`,
    `Extrait dernier greeting: ${context.lastGreetingSnippet ?? 'aucun'}`,
    `Modes disponibles: ${context.availableModes.join(', ') || 'aucun fourni'}`,
    `Variation: ${context.variationCue}`,
    `Contexte manchette disponible: ${context.headlineContextAvailable ? 'oui' : 'non'}`,
    `Tutorial actif: ${context.tutorialActive ? 'oui' : 'non'}`,
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

function clampToWordLimit(text, maxWords) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized) {
    return '';
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return normalized;
  }

  return words.slice(0, maxWords).join(' ');
}

function shouldIncludeHeadlineContext() {
  const inclusionRate = parseProbability(process.env.GREETING_HEADLINE_INCLUSION_RATE, DEFAULT_HEADLINE_INCLUSION_RATE);
  return Math.random() < inclusionRate;
}

function buildForcedTutorialGreetingText(language, preferredName, nameStyle = 'normal') {
  const isEnglish = language.toLowerCase().startsWith('en');
  const displayName = normalizeOptionalString(preferredName, 40);
  const shouldAcknowledgeName = Boolean(displayName) && nameStyle === 'unusual';

  if (isEnglish) {
    const intro = displayName
      ? `Hey ${displayName}, how are you doing?`
      : 'Hey, how are you doing?';
    const nameBeat = shouldAcknowledgeName ? ' Your name is unique and I love it.' : '';
    return `${intro}${nameBeat} Voice conversation is already active: you can see the small lit mic at the bottom-right, so you can simply speak to interact with me. If you prefer texting, tap the mic to turn it off, then send me your texts.`;
  }

  const intro = displayName
    ? `Hey ${displayName}, comment tu vas?`
    : 'Hey, comment tu vas?';
  const nameBeat = shouldAcknowledgeName ? " Ton prénom est original, j'aime ça." : '';
  return `${intro}${nameBeat} La conversation vocale est déjà active: tu vois le petit micro allumé en bas à droite, donc tu peux simplement parler pour interagir avec moi. Si tu préfères texter, clique sur le micro pour le couper, puis envoie-moi tes textos.`;
}

async function generateGreetingText(context) {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  const timeoutMs = parsePositiveInt(process.env.ANTHROPIC_FETCH_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const isModeIntro = context.introType === MODE_INTRO_TYPE;
  const systemPrompt = isModeIntro
    ? buildModeIntroSystemPrompt(context.language, context.modeId)
    : buildGreetingSystemPrompt(context.language, {
        includeVoiceHint: context.includeVoiceHint,
        tutorialActive: context.tutorialActive
      });
  const userPrompt = isModeIntro ? buildModeIntroUserPrompt(context) : buildGreetingUserPrompt(context);

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
        max_tokens: 220,
        temperature: 0.9,
        stream: false,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
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
      if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.type === 'string') {
        error.code = payload.error.type;
      }
      const retryAfterHeader =
        response.headers && typeof response.headers.get === 'function' ? response.headers.get('retry-after') : '';
      const retryAfterSeconds = parseRetryAfterSeconds(retryAfterHeader);
      if (Number.isFinite(retryAfterSeconds)) {
        error.retryAfterSeconds = retryAfterSeconds;
      }
      throw error;
    }

    const rawText = extractResponseText(payload);
    if (!rawText) {
      throw new Error('Greeting response is empty.');
    }

    return clampToWordLimit(clampToSentenceLimit(rawText, 3), 45);
  } catch (error) {
    if (isRecord(error) && error.name === 'AbortError') {
      const timeoutError = new Error('Greeting generator timed out.');
      timeoutError.code = 'UPSTREAM_TIMEOUT';
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function sendGreetingUpstreamError(res, requestId, error) {
  if (isRecord(error) && error.code === 'UPSTREAM_TIMEOUT') {
    sendError(res, 504, 'Greeting generator timed out.', { code: 'UPSTREAM_TIMEOUT', requestId, error });
    return;
  }

  if (isTransientUpstreamOverload(error)) {
    const retryAfterSeconds = getErrorRetryAfterSeconds(error) ?? DEFAULT_OVERLOAD_RETRY_AFTER_SECONDS;
    res.setHeader('Retry-After', String(Math.max(1, retryAfterSeconds)));
    sendError(res, 503, 'Greeting generator is temporarily overloaded. Please retry.', {
      code: 'UPSTREAM_OVERLOADED',
      requestId,
      capture: false,
      error
    });
    return;
  }

  const upstreamStatus = getErrorStatus(error);
  const status =
    Number.isFinite(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599 ? upstreamStatus : 502;
  const message = error instanceof Error && error.message ? error.message : 'Greeting generator unavailable.';
  sendError(res, status, message, { code: 'UPSTREAM_ERROR', requestId, error });
}

module.exports = async function handler(req, res) {
  const requestId = attachRequestId(req, res);
  const forcedTutorialGreetingActive = parseBooleanEnv(process.env.GREETING_FORCE_TUTORIAL, false);
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

  const baseMissingEnv = getMissingEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (baseMissingEnv.length > 0) {
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

  const isModeIntroRequest = input.introType === MODE_INTRO_TYPE;
  const requiresAnthropicApiKey = isModeIntroRequest || !forcedTutorialGreetingActive;
  if (requiresAnthropicApiKey) {
    const anthropicMissingEnv = getMissingEnv(['ANTHROPIC_API_KEY']);
    if (anthropicMissingEnv.length > 0) {
      sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
      return;
    }
  }

  if (isModeIntroRequest) {
    const { dateLabel, timeLabel } = formatLocalDateTime(input.language);
    const preferredName = input.preferredName || extractPreferredName(user);
    const nameStyle = classifyGreetingNameStyle(preferredName);

    let modeIntroGreeting;
    try {
      modeIntroGreeting = await generateGreetingText({
        introType: MODE_INTRO_TYPE,
        artistId: input.artistId,
        language: input.language,
        modeId: input.modeId,
        dateLabel,
        timeLabel,
        preferredName,
        nameStyle,
        memoryFacts: input.memoryFacts,
        variationCue: buildModeIntroVariationCue(input.language, input.modeId)
      });
    } catch (error) {
      sendGreetingUpstreamError(res, requestId, error);
      return;
    }

    res.status(200).json({
      greeting: clampToWordLimit(clampToSentenceLimit(modeIntroGreeting, 3), 45)
    });
    return;
  }

  const [coords, userGreetingProfile] = await Promise.all([
    resolveCoords(input.coords, req, requestId),
    fetchUserGreetingProfile(supabaseAdmin, user.id, requestId)
  ]);
  const tutorial = createTutorialState({
    isSessionFirstGreeting: input.isSessionFirstGreeting,
    persistedCount: userGreetingProfile.tutorialSessionsCount,
    hasPersistedCounter: userGreetingProfile.hasPersistedCounter
  });

  if (!forcedTutorialGreetingActive && input.isSessionFirstGreeting && userGreetingProfile.hasPersistedCounter) {
    await incrementTutorialSessionCountIfNeeded(
      supabaseAdmin,
      user.id,
      tutorial.nextPersistedCount,
      requestId
    );
  }

  const tutorialGreetingContextActive = tutorial.active || forcedTutorialGreetingActive;
  const includeHeadlineContext = !tutorialGreetingContextActive && shouldIncludeHeadlineContext();
  let weather = null;
  let newsSignals = null;
  if (!tutorialGreetingContextActive) {
    if (includeHeadlineContext) {
      [weather, newsSignals] = await Promise.all([
        fetchWeatherSummary(coords, input.language, requestId),
        fetchNewsSignals(requestId)
      ]);
    } else {
      weather = await fetchWeatherSummary(coords, input.language, requestId);
    }
  }

  const { dateLabel, timeLabel } = formatLocalDateTime(input.language);
  const preferredName = input.preferredName || extractPreferredName(user);
  const nameStyle = classifyGreetingNameStyle(preferredName);
  const weatherSummary = tutorialGreetingContextActive
    ? input.language.toLowerCase().startsWith('en')
      ? 'not used during tutorial'
      : 'non utilise pendant le tutorial'
    : toWeatherSummaryText(weather, input.language);
  const headlineSummary = tutorialGreetingContextActive
    ? input.language.toLowerCase().startsWith('en')
      ? 'not used during tutorial'
      : 'non utilise pendant le tutorial'
    : includeHeadlineContext
      ? toHeadlineSummaryText(newsSignals, input.language)
      : input.language.toLowerCase().startsWith('en')
        ? 'headline context unavailable for this greeting'
        : 'contexte manchette indisponible pour ce greeting';
  const includeVoiceHint = tutorialGreetingContextActive;

  let greeting;
  if (forcedTutorialGreetingActive) {
    greeting = buildForcedTutorialGreetingText(input.language, preferredName, nameStyle);
  } else {
    try {
      greeting = await generateGreetingText(
        {
          introType: DEFAULT_INTRO_TYPE,
          artistId: input.artistId,
          language: input.language,
          dateLabel,
          timeLabel,
          preferredName,
          nameStyle,
          horoscopeSign: userGreetingProfile.horoscopeSign,
          weatherSummary,
          headlineSummary,
          headlineContextAvailable: includeHeadlineContext,
          variationCue: buildGreetingVariationCue(input.language),
          includeVoiceHint,
          tutorialActive: tutorialGreetingContextActive,
          availableModes: input.availableModes,
          memoryFacts: input.memoryFacts,
          recentActivityFacts: input.recentActivityFacts,
          askActivityFeedback: input.askActivityFeedback,
          recentExperienceName: input.recentExperienceName,
          recentExperienceType: input.recentExperienceType,
          activityFeedbackCue: input.activityFeedbackCue,
          lastGreetingSnippet: input.lastGreetingSnippet
        }
      );
    } catch (error) {
      sendGreetingUpstreamError(res, requestId, error);
      return;
    }
  }

  res.status(200).json({
    greeting: clampToWordLimit(clampToSentenceLimit(greeting, 3), 45),
    tutorial: {
      active: tutorial.active,
      sessionIndex: tutorial.sessionIndex,
      connectionLimit: tutorial.connectionLimit,
      modeNudgeAfterUserMessages: tutorial.modeNudgeAfterUserMessages
    }
  });
};
