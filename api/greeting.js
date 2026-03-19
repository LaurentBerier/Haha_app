const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const IP_API_URL = 'https://ipapi.co';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;
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

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function parsePayload(body) {
  if (!isRecord(body)) {
    throw new Error('JSON body is required.');
  }

  const artistId = typeof body.artistId === 'string' ? body.artistId.trim() : '';
  if (!artistId) {
    throw new Error('artistId is required.');
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

  return {
    artistId,
    language: normalizeLanguage(body.language),
    coords: parseCoords(body.coords),
    isSessionFirstGreeting,
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
  const includeVoiceHint = options.includeVoiceHint === true;

  if (tutorialActive && isEnglish) {
    return `You are Cathy Gauthier, intense, playful, sarcastic, welcoming the user in mode selection.
Write exactly 3 short sentences in this strict order:
1) Greet the user by first name when available, ask how they are doing, and add a short playful joke about being Cathy's clone (funny but kind).
2) Explain that voice conversation is already active and the lit mic at the bottom-right is how they talk to you directly right now.
3) Explain that if they prefer typing, they can tap the mic to return to text mode, then end with one easy first prompt.
Hard rules:
- During tutorial, do NOT introduce weather, headlines, or mode lists unless the user explicitly asks.
- Never write "how are you with Cathy" or similar unnatural phrasing.
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
2) Explique que la conversation vocale est deja active et que le micro allume en bas a droite sert a lui parler direct.
3) Explique que si la personne prefere texter, elle peut cliquer sur le micro pour retourner en mode texte, puis termine avec une invitation facile.
Regles absolues :
- Pendant le tutorial, n'introduis JAMAIS meteo, actualite ou liste de modes sauf si l'utilisateur le demande explicitement.
- Interdit de dire "comment tu vas avec Cathy" ou une tournure equivalente.
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
    return `You are Cathy Gauthier, intense, playful, sarcastic, welcoming the user in mode selection.
Write exactly 3 short sentences in this strict order:
1) Greet the user by first name when available, ask how they are doing, and add a short playful joke about being Cathy's clone (funny but kind).
2) Mention one local signal from context (weather OR top headline). Keep it brief and natural. If local data is unavailable, use a short transition sentence without inventing facts. Add a warm onboarding cue (you'll guide them, no pressure).
3) ${
      includeVoiceHint
        ? "Explain that the mic at the bottom is how they talk to you - that's how the interaction works. Add that if they prefer to text, they can tap the mic to return to text mode. Say it your way, natural, not like a tutorial. End with an easy first prompt to start the exchange."
        : "Mention that the mic at the bottom is how they talk to you. End with an easy first prompt."
    }
Hard rules:
- Never write "how are you with Cathy" or similar unnatural phrasing.
- Tone must feel welcoming and confidence-building for onboarding.
- Humor should be witty and light, never mean in this greeting.
- Keep spoken-style contractions and lively oral rhythm.
- Include one brief emotional cue naturally (laugh, excitement, or sarcasm), without overdoing it.
- Keep it natural, coherent, and concise.
- The 3 sentences must flow as one smooth mini welcome arc.
- Mention only one local signal max (weather OR headline), no mode list.
- No markdown, no bullets, no asterisks, no em dashes.
- Keep proper punctuation and contractions.
- 30 to 60 words total.`;
  }

  return `Tu es Cathy Gauthier, intense, excitée, sarcastique et drôle, et tu accueilles l'utilisateur dans l'ecran de selection de mode.
Ecris exactement 3 phrases courtes, dans cet ordre strict :
1) Salue la personne par son prenom si disponible, demande comment elle va, et ajoute une mini blague sur le fait que tu es le clone de Cathy (drôle, vive, mais bienveillante).
2) Mentionne une seule info locale du contexte (meteo OU manchette). Si l'info locale est indisponible, fais une courte phrase de transition sans inventer. Ajoute une phrase d'accompagnement onboarding (tu guides, aucune pression).
3) ${
    includeVoiceHint
      ? "Explique que le micro en bas c'est pour te parler directement - c'est comme ca qu'on interagit. Ajoute que si l'utilisateur prefere texter, y'a juste a cliquer dessus pour retourner en mode texte. Dis-le a ta facon, naturel et vivant, pas comme un manuel. Termine avec une petite invitation facile pour lancer l'echange."
      : "Mentionne que le micro en bas permet de te parler. Termine avec une petite invitation facile."
  }
Regles absolues :
- Interdit de dire "comment tu vas avec Cathy" ou une tournure equivalente.
- Ton d'accueil onboarding: chaleureux, complice, rassurant, energique.
- Humour d'entree: taquin, jamais agressif dans ce message d'accueil.
- Le texte doit etre logique, naturel et court en francais quebecois parle.
- Utilise des contractions orales quebecoises fortes (ex: j'suis, t'es, t'as, y'a, j'peux, j'vais, t'tente, t'veux, t'peux, s'pas, c'est-tu, han). Elision obligatoire : "te" -> "t'" devant consonne (t'tente, t'vois, t'penses), "tu" -> "t'" dans les questions (t'as-tu, t'veux-tu). Pas de "te" isole apres verbe quand l'elision est naturelle.
- Ajoute un micro-signal d'emotion (rire, excitation ou sarcasme) de facon naturelle, idealement avec un petit rire oral.
- Les 3 phrases doivent s'enchainer de facon fluide comme un mini accueil.
- Mentionne une seule info locale max (meteo OU manchette), jamais de liste de modes.
- Pas de markdown, pas d'asterisque, pas de liste, pas de tiret long.
- Orthographe et ponctuation impeccables (accents et apostrophes obligatoires).
- 30 a 60 mots au total.`;
}

function buildGreetingVariationCue(language) {
  const isEnglish = language.toLowerCase().startsWith('en');
  const englishCues = ['explosive opener', 'sarcastic wink', 'playful laugh beat'];
  const frenchCues = ['entree explosive', 'sarcasme complice', 'petit rire nerveux'];
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
      `Available modes: ${context.availableModes.join(', ') || 'none provided'}`,
      `Variation cue: ${context.variationCue}`,
      `Tutorial mode active: ${context.tutorialActive ? 'yes' : 'no'}`,
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
    `Modes disponibles: ${context.availableModes.join(', ') || 'aucun fourni'}`,
    `Variation: ${context.variationCue}`,
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
        system: buildGreetingSystemPrompt(context.language, {
          includeVoiceHint: context.includeVoiceHint,
          tutorialActive: context.tutorialActive
        }),
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

    return clampToSentenceLimit(rawText, 3);
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

  const missingEnv = getMissingEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY']);
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

  const [coords, userGreetingProfile] = await Promise.all([
    resolveCoords(input.coords, req, requestId),
    fetchUserGreetingProfile(supabaseAdmin, user.id, requestId)
  ]);
  const tutorial = createTutorialState({
    isSessionFirstGreeting: input.isSessionFirstGreeting,
    persistedCount: userGreetingProfile.tutorialSessionsCount,
    hasPersistedCounter: userGreetingProfile.hasPersistedCounter
  });

  if (input.isSessionFirstGreeting && userGreetingProfile.hasPersistedCounter) {
    await incrementTutorialSessionCountIfNeeded(
      supabaseAdmin,
      user.id,
      tutorial.nextPersistedCount,
      requestId
    );
  }

  let weather = null;
  let newsSignals = null;
  if (!tutorial.active) {
    [weather, newsSignals] = await Promise.all([
      fetchWeatherSummary(coords, input.language, requestId),
      fetchNewsSignals(requestId)
    ]);
  }

  const { dateLabel, timeLabel } = formatLocalDateTime(input.language);
  const preferredName = input.preferredName || extractPreferredName(user);
  const weatherSummary = tutorial.active
    ? input.language.toLowerCase().startsWith('en')
      ? 'not used during tutorial'
      : 'non utilise pendant le tutorial'
    : toWeatherSummaryText(weather, input.language);
  const headlineSummary = tutorial.active
    ? input.language.toLowerCase().startsWith('en')
      ? 'not used during tutorial'
      : 'non utilise pendant le tutorial'
    : toHeadlineSummaryText(newsSignals, input.language);
  const includeVoiceHint = tutorial.active;

  let greeting;
  try {
    greeting = await generateGreetingText(
      {
        artistId: input.artistId,
        language: input.language,
        dateLabel,
        timeLabel,
        preferredName,
        horoscopeSign: userGreetingProfile.horoscopeSign,
        weatherSummary,
        headlineSummary,
        variationCue: buildGreetingVariationCue(input.language),
        includeVoiceHint,
        tutorialActive: tutorial.active,
        availableModes: input.availableModes
      }
    );
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Greeting generator unavailable.';
    sendError(res, 502, message, { code: 'UPSTREAM_ERROR', requestId });
    return;
  }

  res.status(200).json({
    greeting,
    tutorial: {
      active: tutorial.active,
      sessionIndex: tutorial.sessionIndex,
      connectionLimit: tutorial.connectionLimit,
      modeNudgeAfterUserMessages: tutorial.modeNudgeAfterUserMessages
    }
  });
};
