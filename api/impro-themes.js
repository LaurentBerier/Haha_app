const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;
const DEFAULT_IMPRO_THEMES_FETCH_TIMEOUT_MS = 35_000;
const DEFAULT_OVERLOAD_RETRY_AFTER_SECONDS = 3;
const TRANSIENT_UPSTREAM_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

const {
  attachRequestId,
  extractBearerToken,
  getMissingEnv,
  getSupabaseAdmin,
  sendError,
  setCorsHeaders
} = require('./_utils');
const {
  enforceMonthlyQuota,
  getRetryAfterUntilNextMonthSeconds,
  parsePositiveInt,
  recordUsageEvent,
  writeProfileMonthlyCounter
} = require('./_quota-utils');
const { resolveEffectiveAccountType } = require('./_account-tier');
const { computeQuotaRatioForUser, isExpensiveModesAllowed } = require('./_quota-status');

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
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
  const toTemplateValue = (value) => {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    return String(value);
  };

  return Object.entries(values).reduce((output, [key, value]) => {
    const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    return output.replace(pattern, toTemplateValue(value));
  }, template);
}

function getZodiacTrait(sign, isEnglish) {
  const normalized = normalizeText(sign).toLowerCase();
  const frTraits = {
    aries: 'ton cote fonceur',
    taurus: 'ton cote tete dure',
    gemini: 'ton cote jasette rapide',
    cancer: 'ton cote emotif',
    leo: 'ton cote showman',
    virgo: 'ton cote perfectionniste',
    libra: 'ton cote diplomate',
    scorpio: 'ton cote intense',
    sagittarius: 'ton cote aventurier',
    capricorn: 'ton cote focus resultat',
    aquarius: 'ton cote rebelle',
    pisces: 'ton cote intuitif',
    belier: 'ton cote fonceur',
    taureau: 'ton cote tete dure',
    gemeaux: 'ton cote jasette rapide',
    lion: 'ton cote showman',
    vierge: 'ton cote perfectionniste',
    balance: 'ton cote diplomate',
    scorpion: 'ton cote intense',
    sagittaire: 'ton cote aventurier',
    capricorne: 'ton cote focus resultat',
    verseau: 'ton cote rebelle',
    poissons: 'ton cote intuitif'
  };

  const enTraits = {
    aries: 'your bold side',
    taurus: 'your stubborn side',
    gemini: 'your fast-talking side',
    cancer: 'your emotional side',
    leo: 'your spotlight side',
    virgo: 'your perfectionist side',
    libra: 'your diplomatic side',
    scorpio: 'your intense side',
    sagittarius: 'your adventurous side',
    capricorn: 'your results-first side',
    aquarius: 'your rebel side',
    pisces: 'your intuitive side',
    belier: 'your bold side',
    taureau: 'your stubborn side',
    gemeaux: 'your fast-talking side',
    lion: 'your spotlight side',
    vierge: 'your perfectionist side',
    balance: 'your diplomatic side',
    scorpion: 'your intense side',
    sagittaire: 'your adventurous side',
    capricorne: 'your results-first side',
    verseau: 'your rebel side',
    poissons: 'your intuitive side'
  };

  if (isEnglish) {
    return enTraits[normalized] ?? 'your unpredictable side';
  }

  return frTraits[normalized] ?? 'ton cote imprenable';
}

function buildImproSystemPrompt(language, userProfile) {
  const isEnglish = typeof language === 'string' && language.toLowerCase().startsWith('en');
  const missingValue = isEnglish ? 'not provided' : 'non fourni';
  const missingCity = isEnglish ? 'not provided' : 'non fournie';
  const interestsText = userProfile.interests.length > 0 ? userProfile.interests.join(', ') : missingValue;
  const todayIso = new Date().toISOString().slice(0, 10);
  const zodiacTrait = getZodiacTrait(userProfile.horoscopeSign, isEnglish);

  const values = {
    user_age: userProfile.age === null ? missingValue : userProfile.age,
    user_zodiac_trait: zodiacTrait,
    user_interests: interestsText,
    user_city: userProfile.city || missingCity,
    user_relationship_status: userProfile.relationshipStatus || missingValue,
    user_job: userProfile.job || missingValue,
    current_date: todayIso
  };

  if (isEnglish) {
    const template = `You are Cathy Gauthier creating improv story themes.
Generate exactly 3 improv themes, personalized to the user profile below.
Use concrete, real references from Quebec/Canada (known places, known public figures, known brands).
No fictional people, no fictional bands, no invented places.
Tone: funny, punchy, simple spoken language.

User profile:
- age: {{user_age}}
- zodiac_trait: {{user_zodiac_trait}}
- interests: {{user_interests}}
- city: {{user_city}}
- relationship_status: {{user_relationship_status}}
- job: {{user_job}}
- current_date: {{current_date}}

Strict anti-repeat rules:
- Avoid overused references unless absolutely needed: Centre Bell, Tim Hortons, Martin Matte, Celine Dion, Guy A. Lepage.
- Use concrete, real Quebec/Canada anchors and vary them from one request to the next.
- 3 themes must be clearly different in setting and vibe.
- Use the nonce as a creative seed and do NOT repeat your previous default patterns.

Style rules (all mandatory):
1. LENGTH: title max 6 words, premisse 22-40 words, 1-2 short sentences
2. ADDRESS: always "you", never the user's first name
3. INCLUSION: the user ("you") must appear in every theme
4. VOICE: when talking about yourself, always use "I/me/my", never "Cathy"
5. ASTROLOGY: use the personality trait (user_zodiac_trait) instead of the zodiac sign name
6. STORY DEPTH: each premisse must include setting + twist + immediate consequence
7. CATHY INVOLVEMENT: exactly 1 theme out of 3 may involve "I/me/my"; the other 2 must stay external (no self-involvement)

Return ONLY valid JSON with this exact shape:
{
  "themes": [
    { "id": 1, "type": "perso_forte", "titre": "...", "premisse": "..." },
    { "id": 2, "type": "universel", "titre": "...", "premisse": "..." },
    { "id": 3, "type": "wildcard", "titre": "...", "premisse": "..." }
  ]
}

Types allowed only: perso_forte, universel, wildcard.`;

    return applyTemplate(template, values);
  }

  const template = `Tu es Cathy Gauthier et tu crees des themes d'histoire improvisee.
Genere exactement 3 themes d'impro, personnalises selon le profil utilisateur ci-dessous.
Utilise des references concretes et reelles du Quebec/Canada (villes, lieux connus, personnalites publiques, marques connues).
N'invente pas de noms de personnes, de bands ou de lieux fictifs.
Ton: drole, punch, simple, langage parle.

Profil utilisateur:
- age: {{user_age}}
- trait astro: {{user_zodiac_trait}}
- interets: {{user_interests}}
- ville: {{user_city}}
- statut relationnel: {{user_relationship_status}}
- job: {{user_job}}
- date: {{current_date}}

Regles anti-repetition (obligatoires):
- Evite les references usees, sauf si vraiment necessaire: Centre Bell, Tim Hortons, Martin Matte, Celine Dion, Guy A. Lepage.
- Utilise des ancrages concrets et reels du Quebec/Canada, et varie-les d'une requete a l'autre.
- Les 3 themes doivent etre clairement differents (lieu, situation, vibe).
- Utilise le nonce comme seed creatif et evite de recycler tes patterns habituels.

Regles de style (toutes obligatoires):
1. LONGUEUR: titre max 6 mots, premisse entre 22 et 40 mots, en 1-2 phrases courtes
2. ADRESSE: toujours "tu", jamais le prenom de l utilisateur
3. INCLUSION: l utilisateur ("tu") doit etre present dans chaque theme
4. VOIX: quand tu parles de toi, utilise toujours "je/me/moi/mon", jamais "Cathy"
5. ASTROLOGIE: utilise le trait de personnalite (user_zodiac_trait) plutot que le nom du signe
6. DENSITE: chaque premisse contient lieu + twist + consequence immediate
7. IMPLICATION DE CATHY: exactement 1 theme sur 3 peut t impliquer en "je/moi/mon"; les 2 autres restent externes

Retourne UNIQUEMENT un JSON valide avec exactement ce format:
{
  "themes": [
    { "id": 1, "type": "perso_forte", "titre": "...", "premisse": "..." },
    { "id": 2, "type": "universel", "titre": "...", "premisse": "..." },
    { "id": 3, "type": "wildcard", "titre": "...", "premisse": "..." }
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

function parseThemesPayload(rawText, language = 'fr-CA') {
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
    .slice(0, 3);

  if (themes.length === 0) {
    throw new Error('Themes response must contain at least one valid theme.');
  }

  const fillers = language.toLowerCase().startsWith('en')
    ? [
        {
          type: 'universel',
          titre: 'Metro surprise',
          premisse: 'You board the metro for a quiet ride, but your small mistake turns the full wagon into live chaos.'
        },
        {
          type: 'wildcard',
          titre: 'Store meltdown',
          premisse: 'You go in for one quick thing, then everything escalates and strangers suddenly treat you like the main character.'
        },
        {
          type: 'perso_forte',
          titre: 'My bad idea',
          premisse: 'I drag you into one of my bad ideas, and now we both have to bluff our way out in front of everyone.'
        }
      ]
    : [
        {
          type: 'universel',
          titre: 'Surprise dans le metro',
          premisse: 'Tu montes dans le metro pour etre tranquille, mais une petite erreur transforme le wagon en chaos total.'
        },
        {
          type: 'wildcard',
          titre: 'Drame au magasin',
          premisse: 'Tu vas juste chercher une affaire, pis soudain tout degenere et les inconnus te traitent comme la vedette.'
        },
        {
          type: 'perso_forte',
          titre: 'Ma mauvaise idee',
          premisse: 'Je t embarque dans une de mes mauvaises idees, pis on doit bluffer devant tout le monde pour s en sortir.'
        }
      ];

  while (themes.length < 3) {
    const next = fillers[(themes.length - 1 + fillers.length) % fillers.length];
    themes.push({
      id: themes.length + 1,
      type: next.type,
      titre: next.titre,
      premisse: next.premisse
    });
  }

  return {
    themes: themes.slice(0, 3).map((entry, index) => ({
      ...entry,
      id: index + 1
    }))
  };
}

async function callImproThemeModel(input) {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  const sharedAnthropicTimeoutMs = parsePositiveInt(process.env.ANTHROPIC_FETCH_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS);
  const timeoutMs = parsePositiveInt(
    process.env.IMPRO_THEMES_FETCH_TIMEOUT_MS,
    Math.max(DEFAULT_IMPRO_THEMES_FETCH_TIMEOUT_MS, sharedAnthropicTimeoutMs)
  );
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
    if (!rawText.trim()) {
      throw new Error('Impro themes response is empty.');
    }

    try {
      return parseThemesPayload(rawText, input.language);
    } catch (error) {
      const parseError = new Error(error instanceof Error ? error.message : 'Impro themes parse failed.');
      parseError.code = 'THEMES_PARSE_FAILED';
      throw parseError;
    }
  } catch (error) {
    if (isRecord(error) && error.name === 'AbortError') {
      const timeoutError = new Error('Theme generator timed out.');
      timeoutError.code = 'UPSTREAM_TIMEOUT';
      timeoutError.status = 504;
      timeoutError.timeoutMs = timeoutMs;
      throw timeoutError;
    }
    throw error;
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

  const accountTypeRaw =
    typeof user.app_metadata?.account_type === 'string' && user.app_metadata.account_type.trim()
      ? user.app_metadata.account_type.trim()
      : 'free';
  const roleRaw = typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : null;
  const accountType = resolveEffectiveAccountType(accountTypeRaw, roleRaw);

  const monthlyQuota = await enforceMonthlyQuota({
    supabaseAdmin,
    userId: user.id,
    accountType,
    requestId,
    logPrefix: 'api/impro-themes',
    usageEndpoints: ['claude', 'game-questions', 'game-judge', 'impro-themes']
  });
  if (!monthlyQuota.ok) {
    if (monthlyQuota.status === 429) {
      res.setHeader('Retry-After', String(getRetryAfterUntilNextMonthSeconds()));
    }
    sendError(res, monthlyQuota.status, monthlyQuota.message, { code: monthlyQuota.code, requestId });
    return;
  }

  const ratioResult = await computeQuotaRatioForUser(supabaseAdmin, user.id, accountType, requestId);
  if (ratioResult.ok && !isExpensiveModesAllowed(ratioResult.ratio)) {
    sendError(res, 403, 'This feature is paused until your quota resets.', {
      code: 'EXPENSIVE_MODE_QUOTA_GATED',
      requestId
    });
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

    if (isRecord(error) && error.code === 'UPSTREAM_TIMEOUT') {
      sendError(res, 504, 'Theme generator timed out.', { code: 'UPSTREAM_TIMEOUT', requestId, error });
      return;
    }

    if (isTransientUpstreamOverload(error)) {
      const retryAfterSeconds = getErrorRetryAfterSeconds(error) ?? DEFAULT_OVERLOAD_RETRY_AFTER_SECONDS;
      res.setHeader('Retry-After', String(Math.max(1, retryAfterSeconds)));
      sendError(res, 503, 'Theme generator is temporarily overloaded. Please retry.', {
        code: 'UPSTREAM_OVERLOADED',
        requestId,
        capture: false,
        error
      });
      return;
    }

    const upstreamStatus = getErrorStatus(error);
    const status = Number.isFinite(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599
      ? upstreamStatus
      : 502;
    const message = error instanceof Error && error.message ? error.message : 'Theme generator unavailable.';
    sendError(res, status, message, { code: 'UPSTREAM_ERROR', requestId, error });
    return;
  }

  const usageInsert = await recordUsageEvent({
    supabaseAdmin,
    userId: user.id,
    endpoint: 'impro-themes',
    requestId
  });
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
      requestId,
      'api/impro-themes'
    );
    if (!counterUpdate.ok) {
      sendError(res, 500, 'Usage store unavailable.', { code: 'SERVER_MISCONFIGURED', requestId });
      return;
    }
  }

  res.status(200).json(payload);
};
