const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;
const DEFAULT_MONTHLY_CAPS = {
  free: 15,
  regular: 45,
  premium: 110
  // admin intentionally omitted => unlimited
};

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

function getMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function getNextMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

function getRetryAfterUntilNextMonthSeconds() {
  const nextMonthStartMs = Date.parse(getNextMonthStartIso());
  return Math.max(1, Math.ceil((nextMonthStartMs - Date.now()) / 1000));
}

function getMonthlyCap(accountType) {
  const normalizedAccountType = typeof accountType === 'string' && accountType.trim() ? accountType.trim() : 'free';
  const key = `CLAUDE_MONTHLY_CAP_${normalizedAccountType.toUpperCase()}`;
  const fromEnv = parsePositiveInt(process.env[key], 0);
  if (fromEnv > 0) {
    return fromEnv;
  }

  const cap = DEFAULT_MONTHLY_CAPS[normalizedAccountType];
  return cap ?? DEFAULT_MONTHLY_CAPS.free;
}

function isMissingMonthlyCounterColumnError(error) {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
  if (code === '42703') {
    return true;
  }

  const message = isRecord(error) && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return message.includes('monthly_message_count') || message.includes('monthly_reset_at');
}

function isMissingUsageEventsRequestIdColumn(error) {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
  if (code !== '42703') {
    return false;
  }

  const message = isRecord(error) && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return message.includes('request_id');
}

async function readProfileMonthlyCounter(supabaseAdmin, userId, requestId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('monthly_message_count, monthly_reset_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    if (isMissingMonthlyCounterColumnError(error)) {
      return { ok: true, unsupported: true };
    }

    console.error(`[api/impro-themes][${requestId}] Failed to read profile monthly counter`, error);
    return { ok: false, error };
  }

  if (!data || !isRecord(data)) {
    return { ok: true, unsupported: true };
  }

  return {
    ok: true,
    unsupported: false,
    monthlyMessageCount:
      typeof data.monthly_message_count === 'number' && Number.isFinite(data.monthly_message_count)
        ? Math.max(0, Math.floor(data.monthly_message_count))
        : 0,
    monthlyResetAt: typeof data.monthly_reset_at === 'string' ? data.monthly_reset_at : ''
  };
}

async function writeProfileMonthlyCounter(supabaseAdmin, userId, monthStartIso, nextCount, requestId) {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      monthly_message_count: Math.max(0, nextCount),
      monthly_reset_at: monthStartIso
    })
    .eq('id', userId);

  if (error) {
    if (isMissingMonthlyCounterColumnError(error)) {
      return { ok: true, unsupported: true };
    }

    console.error(`[api/impro-themes][${requestId}] Failed to write profile monthly counter`, error);
    return { ok: false, error };
  }

  return { ok: true, unsupported: false };
}

async function enforceMonthlyQuota(supabaseAdmin, userId, accountType, requestId) {
  const normalizedAccountType = typeof accountType === 'string' && accountType.trim() ? accountType.trim() : 'free';
  if (normalizedAccountType === 'admin') {
    return { ok: true, source: 'admin', monthStartIso: getMonthStartIso(), used: 0 };
  }

  const effectiveCap = getMonthlyCap(normalizedAccountType);
  const monthStartIso = getMonthStartIso();

  const profileCounter = await readProfileMonthlyCounter(supabaseAdmin, userId, requestId);
  if (!profileCounter.ok) {
    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Usage store unavailable.'
    };
  }

  if (!profileCounter.unsupported) {
    const monthStartMs = Date.parse(monthStartIso);
    const monthlyResetMs = Date.parse(profileCounter.monthlyResetAt);
    const isCurrentMonth = Number.isFinite(monthlyResetMs) && monthlyResetMs >= monthStartMs;
    const used = isCurrentMonth ? profileCounter.monthlyMessageCount : 0;

    if (used >= effectiveCap) {
      return {
        ok: false,
        status: 429,
        code: 'MONTHLY_QUOTA_EXCEEDED',
        message: `Monthly message quota exceeded. Limit: ${effectiveCap} messages.`
      };
    }

    return { ok: true, source: 'profile', monthStartIso, used };
  }

  const { count, error } = await supabaseAdmin
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('endpoint', ['claude', 'game-questions', 'game-judge', 'impro-themes'])
    .gte('created_at', monthStartIso);

  if (error) {
    console.error(`[api/impro-themes][${requestId}] Failed to read monthly usage`, error);
    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Usage store unavailable.'
    };
  }

  if ((count ?? 0) >= effectiveCap) {
    return {
      ok: false,
      status: 429,
      code: 'MONTHLY_QUOTA_EXCEEDED',
      message: `Monthly message quota exceeded. Limit: ${effectiveCap} messages.`
    };
  }

  return { ok: true, source: 'usage_events', monthStartIso, used: count ?? 0 };
}

async function recordUsageEvent(supabaseAdmin, userId, requestId) {
  const nowIso = new Date().toISOString();
  const insertPayload = {
    user_id: userId,
    endpoint: 'impro-themes',
    request_id: requestId,
    created_at: nowIso
  };

  let { error } = await supabaseAdmin.from('usage_events').insert(insertPayload);
  if (error && isMissingUsageEventsRequestIdColumn(error)) {
    const fallbackPayload = {
      user_id: userId,
      endpoint: 'impro-themes',
      created_at: nowIso
    };
    ({ error } = await supabaseAdmin.from('usage_events').insert(fallbackPayload));
  }

  if (error) {
    return { ok: false, error };
  }

  return { ok: true };
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUserProfile(rawProfile) {
  const source = isRecord(rawProfile) ? rawProfile : {};
  const interestsRaw = Array.isArray(source.interests) ? source.interests : [];

  const interests = interestsRaw
    .map((interest) => normalizeText(interest))
    .filter(Boolean)
    .slice(0, 8);

  const age = Number.isFinite(source.age) ? Math.max(0, Math.floor(source.age)) : null;

  return {
    preferredName: normalizeText(source.preferredName),
    age,
    horoscopeSign: normalizeText(source.horoscopeSign),
    interests,
    relationshipStatus: normalizeText(source.relationshipStatus),
    city: normalizeText(source.city),
    job: normalizeText(source.job)
  };
}

function parsePayload(body) {
  if (!isRecord(body)) {
    throw new Error('JSON body is required.');
  }

  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'fr-CA';
  const userProfile = normalizeUserProfile(body.userProfile);
  const nonce =
    Number.isFinite(body.nonce) && Number.isInteger(body.nonce) ? Number(body.nonce) : Date.now();
  const avoidThemes = Array.isArray(body.avoidThemes)
    ? body.avoidThemes
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
        .slice(0, 20)
    : [];

  return {
    language,
    userProfile,
    nonce,
    avoidThemes
  };
}

function applyTemplate(template, values) {
  return Object.entries(values).reduce((output, [key, value]) => {
    const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    return output.replace(pattern, String(value));
  }, template);
}

function getZodiacTraits(sign, language) {
  const normalized = normalizeText(sign).toLowerCase();
  const isEnglish = typeof language === 'string' && language.toLowerCase().startsWith('en');

  const frTraits = {
    aries: 'tu fonces vite et tu decides sur un coup de tete',
    taurus: 'tu restes solide, tetu, et tu laches pas le morceau',
    gemini: 'tu jases vite, tu changes didee, et tu improvises fort',
    leo: 'tu veux briller, prendre la place, et assumer le show',
    virgo: 'tu remarques tout, tu analyses, et tu veux que ca marche',
    libra: 'tu cherches le juste milieu, mais tu peux virer indecis',
    scorpio: 'tu sens tout, tu gardes le controle, et tu piques juste',
    sagittarius: 'tu vis grand, tu niaises fort, et tu detestes la routine',
    capricorn: 'tu veux du concret, du resultat, et zero perte de temps',
    aquarius: 'tu penses hors cadre, un peu rebelle, souvent en avance',
    pisces: 'tu es intuitif, tres imaginaire, et parfois dans la lune',
    belier: 'tu fonces vite et tu decides sur un coup de tete',
    taureau: 'tu restes solide, tetu, et tu laches pas le morceau',
    gemeaux: 'tu jases vite, tu changes didee, et tu improvises fort',
    cancer: 'tu captes l ambiance, t es protecteur, mais emotif',
    lion: 'tu veux briller, prendre la place, et assumer le show',
    vierge: 'tu remarques tout, tu analyses, et tu veux que ca marche',
    balance: 'tu cherches le juste milieu, mais tu peux virer indecis',
    scorpion: 'tu sens tout, tu gardes le controle, et tu piques juste',
    sagittaire: 'tu vis grand, tu niaises fort, et tu detestes la routine',
    capricorne: 'tu veux du concret, du resultat, et zero perte de temps',
    verseau: 'tu penses hors cadre, un peu rebelle, souvent en avance',
    poissons: 'tu es intuitif, tres imaginaire, et parfois dans la lune'
  };

  const enTraits = {
    aries: 'you move fast and decide on instinct',
    taurus: 'you are steady, stubborn, and persistent',
    gemini: 'you talk fast, pivot quickly, and improvise a lot',
    cancer: 'you read the room and react emotionally',
    leo: 'you like to shine and own the stage',
    virgo: 'you notice details and try to fix everything',
    libra: 'you aim for balance but can overthink choices',
    scorpio: 'you read people deeply and strike at the right time',
    sagittarius: 'you go big, joke hard, and hate routine',
    capricorn: 'you want concrete results and no wasted time',
    aquarius: 'you think outside the box and break patterns',
    pisces: 'you are intuitive, imaginative, and often in your own world',
    belier: 'you move fast and decide on instinct',
    taureau: 'you are steady, stubborn, and persistent',
    gemeaux: 'you talk fast, pivot quickly, and improvise a lot',
    lion: 'you like to shine and own the stage',
    vierge: 'you notice details and try to fix everything',
    balance: 'you aim for balance but can overthink choices',
    scorpion: 'you read people deeply and strike at the right time',
    sagittaire: 'you go big, joke hard, and hate routine',
    capricorne: 'you want concrete results and no wasted time',
    verseau: 'you think outside the box and break patterns',
    poissons: 'you are intuitive, imaginative, and often in your own world'
  };

  if (isEnglish) {
    return enTraits[normalized] ?? 'you react fast, think creatively, and adapt on the fly';
  }

  return frTraits[normalized] ?? 'tu reagis vite, t improvises, et tu trouves une sortie de secours';
}

function buildImproSystemPrompt(language, userProfile) {
  const isEnglish = typeof language === 'string' && language.toLowerCase().startsWith('en');
  const interestsText = userProfile.interests.length > 0 ? userProfile.interests.join(', ') : 'non fournis';
  const todayIso = new Date().toISOString().slice(0, 10);
  const zodiacTraits = getZodiacTraits(userProfile.horoscopeSign, language);

  const values = {
    user_age: userProfile.age ?? 'non fourni',
    user_zodiac_traits: zodiacTraits,
    user_interests: interestsText,
    user_city: userProfile.city || 'non fournie',
    user_relationship_status: userProfile.relationshipStatus || 'non fourni',
    user_job: userProfile.job || 'non fourni',
    current_date: todayIso
  };

  if (isEnglish) {
    const template = `You are Cathy Gauthier creating improv story themes.
Generate exactly 4 short themes, personalized to the user profile below.
Use concrete, real references from Quebec/Canada (known places, known public figures, known brands).
No fictional people, no fictional bands, no invented places.
Tone: funny, punchy, simple spoken language.

User profile:
- age: {{user_age}}
- zodiac_traits: {{user_zodiac_traits}}
- interests: {{user_interests}}
- city: {{user_city}}
- relationship_status: {{user_relationship_status}}
- job: {{user_job}}
- current_date: {{current_date}}

Strict anti-repeat rules:
- Avoid overused references unless absolutely needed: Centre Bell, Tim Hortons, Martin Matte, Celine Dion, Guy A. Lepage.
- Use concrete, real Quebec/Canada anchors and vary them from one request to the next.
- 4 themes must be clearly different in setting and vibe.
- Use the nonce as a creative seed and do NOT repeat your previous default patterns.

Quality rules:
- Make themes as concise as possible, short and punchy.
- Every premisse must clearly include the user as "you" taking action.
- Never use the user's first name. Use only "you".
- Include Cathy explicitly in at least 3 themes out of 4.
- Astrology is optional and should appear in at most 1 theme out of 4.
- If astrology is used, say "astrology" and personality traits only. Never name the zodiac sign. Never use the word Pisces.

Return ONLY valid JSON with this exact shape:
{
  "themes": [
    { "id": 1, "type": "perso_forte", "titre": "...", "premisse": "..." },
    { "id": 2, "type": "universel", "titre": "...", "premisse": "..." },
    { "id": 3, "type": "wildcard", "titre": "...", "premisse": "..." },
    { "id": 4, "type": "universel", "titre": "...", "premisse": "..." }
  ]
}

Types allowed only: perso_forte, universel, wildcard.`;

    return applyTemplate(template, values);
  }

  const template = `Tu es Cathy Gauthier et tu crees des themes d'histoire improvisee.
Genere exactement 4 themes courts, personnalises selon le profil utilisateur ci-dessous.
Utilise des references concretes et reelles du Quebec/Canada (villes, lieux connus, personnalites publiques, marques connues).
N'invente pas de noms de personnes, de bands ou de lieux fictifs.
Ton: drole, punch, simple, langage parle.

Profil utilisateur:
- age: {{user_age}}
- traits astro: {{user_zodiac_traits}}
- interets: {{user_interests}}
- ville: {{user_city}}
- statut relationnel: {{user_relationship_status}}
- job: {{user_job}}
- date: {{current_date}}

Regles anti-repetition (obligatoires):
- Evite les references usees, sauf si vraiment necessaire: Centre Bell, Tim Hortons, Martin Matte, Celine Dion, Guy A. Lepage.
- Utilise des ancrages concrets et reels du Quebec/Canada, et varie-les d'une requete a l'autre.
- Les 4 themes doivent etre clairement differents (lieu, situation, vibe).
- Utilise le nonce comme seed creatif et evite de recycler tes patterns habituels.

Regles qualite:
- Fais des themes le plus concis possible, courts et punches.
- Chaque premisse doit inclure clairement l utilisateur (tu) en action.
- N utilise jamais le prenom de l utilisateur. Utilise seulement "tu".
- Inclure Cathy explicitement dans au moins 3 themes sur 4.
- L astrologie est optionnelle et doit apparaitre au maximum dans 1 theme sur 4.
- Si tu touches a l astrologie, parle en termes d astrologie et de traits de personnalite seulement.
- Ne nomme jamais le signe. N utilise jamais le mot Pisces.

Retourne UNIQUEMENT un JSON valide avec exactement ce format:
{
  "themes": [
    { "id": 1, "type": "perso_forte", "titre": "...", "premisse": "..." },
    { "id": 2, "type": "universel", "titre": "...", "premisse": "..." },
    { "id": 3, "type": "wildcard", "titre": "...", "premisse": "..." },
    { "id": 4, "type": "universel", "titre": "...", "premisse": "..." }
  ]
}

Types permis seulement: perso_forte, universel, wildcard.`;

  return applyTemplate(template, values);
}

function buildImproUserPrompt(input) {
  const avoidLine =
    input.avoidThemes.length > 0 ? input.avoidThemes.map((value) => `- ${value}`).join('\n') : '- none';
  return `Language: ${input.language}
Nonce: ${input.nonce}
Avoid reusing these exact ideas:
${avoidLine}

Generate improv themes now.`;
}

function extractResponseText(payload) {
  if (!payload || !Array.isArray(payload.content)) {
    return '';
  }

  return payload.content
    .filter((entry) => isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text)
    .join('');
}

function stripCodeFences(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function extractJsonObject(input) {
  const start = input.indexOf('{');
  const end = input.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    return '';
  }
  return input.slice(start, end + 1);
}

function hasUserReference(premisse, language) {
  const value = normalizeText(premisse).toLowerCase();
  if (!value) {
    return false;
  }
  if (language.toLowerCase().startsWith('en')) {
    return /\b(you|your)\b/.test(value);
  }
  return /\b(tu|toi|ton|ta|tes)\b/.test(value);
}

function parseThemesPayload(rawText, language = 'fr-CA', preferredName = '') {
  const text = stripCodeFences(rawText);
  let payload = null;

  try {
    payload = JSON.parse(text);
  } catch {
    const extracted = extractJsonObject(text);
    if (!extracted) {
      throw new Error('Themes response is not valid JSON.');
    }
    payload = JSON.parse(extracted);
  }

  if (!isRecord(payload) || !Array.isArray(payload.themes)) {
    throw new Error('Themes response has invalid shape.');
  }

  const allowedTypes = new Set(['perso_forte', 'universel', 'wildcard']);
  const themes = payload.themes
    .filter((entry) => isRecord(entry))
    .map((entry, index) => {
      const maybeId = Number.parseInt(String(entry.id ?? ''), 10);
      const typeRaw = normalizeText(entry.type);
      const type = allowedTypes.has(typeRaw) ? typeRaw : 'universel';
      const titre = normalizeText(entry.titre);
      const premisse = normalizeText(entry.premisse);

      return {
        id: Number.isFinite(maybeId) && maybeId > 0 ? maybeId : index + 1,
        type,
        titre,
        premisse
      };
    })
    .filter((entry) => Boolean(entry.titre) && Boolean(entry.premisse))
    .slice(0, 4);

  if (themes.length !== 4) {
    throw new Error('Themes response must contain exactly 4 valid themes.');
  }

  const missingUserReference = themes.some((entry) => !hasUserReference(entry.premisse, language));
  if (missingUserReference) {
    throw new Error('Each theme must include the user in action.');
  }

  const cathyCount = themes.filter((entry) => /\bcathy\b/i.test(entry.premisse)).length;
  if (cathyCount < 3) {
    throw new Error('At least three themes must include Cathy explicitly.');
  }

  const normalizedPreferredName = normalizeText(preferredName).toLowerCase();
  if (normalizedPreferredName) {
    const safeName = normalizedPreferredName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRegex = new RegExp(`\\b${safeName}\\b`, 'i');
    const usesUserName = themes.some((entry) => nameRegex.test(entry.titre) || nameRegex.test(entry.premisse));
    if (usesUserName) {
      throw new Error('Themes must not include the user preferred name.');
    }
  }

  const containsPisces = themes.some((entry) => /\bpisces\b/i.test(entry.titre) || /\bpisces\b/i.test(entry.premisse));
  if (containsPisces) {
    throw new Error('Themes must not include the word Pisces.');
  }

  const astrologyThemeCount = themes.filter((entry) => /\b(astrologie|astrology|horoscope|zodiac)\b/i.test(entry.premisse)).length;
  if (astrologyThemeCount > 1) {
    throw new Error('Astrology should appear in at most one theme.');
  }

  return { themes };
}

async function callImproThemeModel(input) {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const timeoutMs = parsePositiveInt(process.env.ANTHROPIC_FETCH_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
        max_tokens: 500,
        temperature: 0.9,
        stream: false,
        system: buildImproSystemPrompt(input.language, input.userProfile),
        messages: [{ role: 'user', content: buildImproUserPrompt(input) }]
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        isRecord(payload) &&
        isRecord(payload.error) &&
        typeof payload.error.message === 'string' &&
        payload.error.message
          ? payload.error.message
          : 'Impro themes generation failed.';
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    const rawText = extractResponseText(payload);
    if (!rawText.trim()) {
      throw new Error('Impro themes response is empty.');
    }

    try {
      return parseThemesPayload(rawText, input.language, input.userProfile.preferredName);
    } catch (error) {
      const parseError = new Error(error instanceof Error ? error.message : 'Impro themes parse failed.');
      parseError.code = 'THEMES_PARSE_FAILED';
      throw parseError;
    }
  } finally {
    clearTimeout(timeout);
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

  const accountType =
    typeof user.app_metadata?.account_type === 'string' && user.app_metadata.account_type.trim()
      ? user.app_metadata.account_type.trim()
      : 'free';

  const monthlyQuota = await enforceMonthlyQuota(supabaseAdmin, user.id, accountType, requestId);
  if (!monthlyQuota.ok) {
    if (monthlyQuota.status === 429) {
      res.setHeader('Retry-After', String(getRetryAfterUntilNextMonthSeconds()));
    }
    sendError(res, monthlyQuota.status, monthlyQuota.message, { code: monthlyQuota.code, requestId });
    return;
  }

  let payload;
  try {
    payload = await callImproThemeModel(input);
  } catch (error) {
    if (isRecord(error) && error.code === 'THEMES_PARSE_FAILED') {
      sendError(res, 422, 'Theme output is invalid.', { code: 'THEMES_PARSE_FAILED', requestId });
      return;
    }
    const message = error instanceof Error && error.message ? error.message : 'Theme generator unavailable.';
    sendError(res, 502, message, { code: 'UPSTREAM_ERROR', requestId });
    return;
  }

  const usageInsert = await recordUsageEvent(supabaseAdmin, user.id, requestId);
  if (!usageInsert.ok) {
    console.error(`[api/impro-themes][${requestId}] Failed to write usage_events`, usageInsert.error);
    sendError(res, 500, 'Usage store unavailable.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  if (monthlyQuota.source === 'profile') {
    const used = typeof monthlyQuota.used === 'number' && Number.isFinite(monthlyQuota.used) ? monthlyQuota.used : 0;
    const counterUpdate = await writeProfileMonthlyCounter(
      supabaseAdmin,
      user.id,
      monthlyQuota.monthStartIso,
      used + 1,
      requestId
    );

    if (!counterUpdate.ok) {
      sendError(res, 500, 'Usage store unavailable.', { code: 'SERVER_MISCONFIGURED', requestId });
      return;
    }
  }

  res.status(200).json(payload);
};
