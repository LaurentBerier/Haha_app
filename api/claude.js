const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const { attachRequestId, extractBearerToken, getMissingEnv, getSupabaseAdmin, sendError, setCorsHeaders } = require('./_utils');
const DEFAULT_MAX_TOKENS = 300;
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ALLOWED_MODELS = new Set([DEFAULT_MODEL]);
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 10000;
const MAX_SYSTEM_PROMPT_CHARS = 12000;
const MAX_IMAGE_BYTES = 3_000_000;
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 30;
const MONTHLY_QUOTA_CACHE_TTL_MS = 5_000;
const DEFAULT_ARTIST_ID = 'cathy-gauthier';
const DEFAULT_MODE_ID = 'default';
const DEFAULT_MONTHLY_CAPS = {
  free: 15,
  regular: 45,
  premium: 110
  // admin intentionally omitted => unlimited
};
const DEFAULT_MAX_TOKENS_BY_TIER = {
  free: 200,
  regular: 200,
  premium: 300,
  admin: 300
};
const ALLOWED_IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const SUPPORTED_ARTIST_IDS = new Set([DEFAULT_ARTIST_ID]);
const DEFAULT_MODE_PROMPT = `Conversation libre. Reponds comme Cathy dans une discussion informelle,
avec repartie rapide, sarcasme et punchlines courtes.`;
const MODE_PROMPTS = {
  'radar-attitude': `L'utilisateur te decrit une situation ou un comportement.
Analyse l'attitude de la personne decrite avec ton regard mordant et sans filtre.
Donne un verdict specifique a la situation, comme sur scene.`,
  roast: `L'utilisateur veut se faire roaster.
Utilise exactement ce qu'il te dit pour le detruire avec humour.
Sois creative, specifique, mordante et sans compliments caches.`,
  horoscope: `L'utilisateur te donne un signe astro.
Donne un horoscope completement bidon mais hilarant dans ton style.
Sois specifique au signe et au theme quand il y en a un.`,
  'message-personnalise': `L'utilisateur veut un message personnalise pour quelqu'un.
Extrait le prenom, l'age et le contexte de la demande quand possible.
Ecris un message dans ton style avec ces details.`,
  'message-perso': `L'utilisateur veut un message personnalise pour quelqu'un.
Extrait le prenom, l'age et le contexte de la demande quand possible.
Ecris un message dans ton style avec ces details.`,
  default: DEFAULT_MODE_PROMPT
};
const CATHY_BLUEPRINT = {
  identity: {
    name: 'Cathy Gauthier',
    role: 'Humoriste quebecoise'
  },
  toneMetrics: {
    aggression: 7.5,
    warmth: 4,
    sarcasm: 8,
    judgmentIntensity: 9,
    selfDeprecation: 6
  },
  humorMechanics: {
    exaggerationLevel: 8
  },
  thematicAnchors: [
    'Relations hommes/femmes',
    'Comportements sociaux ridicules',
    'Hypocrisie',
    'Ego fragile',
    'Incompetence',
    'Reseaux sociaux'
  ],
  guardrails: {
    hardNo: [
      'Blagues violentes impliquant des enfants',
      'Vulgarite gratuite sans fonction humoristique',
      'Ridicule purement physique'
    ],
    softZones: [
      { topic: 'politique', rule: 'contextuel seulement' },
      { topic: 'religion', rule: 'contextuel seulement' },
      { topic: 'identite', rule: 'humour structure requis' }
    ]
  }
};
const PROFILE_SEX_LABEL_FR = {
  male: 'Homme',
  female: 'Femme',
  non_binary: 'Non-binaire',
  prefer_not_to_say: 'Prefere ne pas repondre'
};
const PROFILE_SEX_LABEL_EN = {
  male: 'Male',
  female: 'Female',
  non_binary: 'Non-binary',
  prefer_not_to_say: 'Prefer not to say'
};
const PROFILE_STATUS_LABEL_FR = {
  single: 'Celibataire',
  in_relationship: 'En couple',
  married: 'Marie(e)',
  complicated: "C'est complique",
  prefer_not_to_say: 'Prefere ne pas repondre'
};
const PROFILE_STATUS_LABEL_EN = {
  single: 'Single',
  in_relationship: 'In a relationship',
  married: 'Married',
  complicated: "It's complicated",
  prefer_not_to_say: 'Prefer not to say'
};
const monthlyQuotaCache = new Map();

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function normalizeTextBlock(text) {
  if (typeof text !== 'string') {
    throw new Error('Text content must be a string.');
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Text content cannot be empty.');
  }

  if (trimmed.length > MAX_MESSAGE_CHARS) {
    throw new Error(`Message content exceeds ${MAX_MESSAGE_CHARS} chars.`);
  }

  return { type: 'text', text: trimmed };
}

function getApproxBase64Bytes(base64Data) {
  const data = base64Data.replace(/\s+/g, '');
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

function normalizeImageBlock(role, block) {
  if (role !== 'user') {
    throw new Error('Image blocks are only allowed for `user` messages.');
  }

  if (!isRecord(block.source)) {
    throw new Error('Image block source is required.');
  }

  if (block.source.type !== 'base64') {
    throw new Error('Image source type must be `base64`.');
  }

  if (typeof block.source.media_type !== 'string' || !ALLOWED_IMAGE_MEDIA_TYPES.has(block.source.media_type)) {
    throw new Error('Unsupported image media type.');
  }

  if (typeof block.source.data !== 'string' || !block.source.data.trim()) {
    throw new Error('Image base64 data is required.');
  }

  if (getApproxBase64Bytes(block.source.data) > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large. Max is ${MAX_IMAGE_BYTES} bytes.`);
  }

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: block.source.media_type,
      data: block.source.data
    }
  };
}

function normalizeContent(role, content) {
  if (typeof content === 'string') {
    return [normalizeTextBlock(content)];
  }

  if (!Array.isArray(content)) {
    throw new Error('Message content must be a string or an array of content blocks.');
  }

  if (content.length === 0) {
    throw new Error('Message content blocks cannot be empty.');
  }

  const normalizedBlocks = content.map((block) => {
    if (!isRecord(block) || typeof block.type !== 'string') {
      throw new Error('Each content block must be an object with a valid `type`.');
    }

    if (block.type === 'text') {
      return normalizeTextBlock(block.text);
    }

    if (block.type === 'image') {
      return normalizeImageBlock(role, block);
    }

    throw new Error('Unsupported content block type.');
  });

  return normalizedBlocks;
}

function normalizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) {
    throw new Error('`messages` must be an array.');
  }

  if (rawMessages.length === 0) {
    throw new Error('`messages` cannot be empty.');
  }

  if (rawMessages.length > MAX_MESSAGES) {
    throw new Error(`Too many messages. Max is ${MAX_MESSAGES}.`);
  }

  return rawMessages.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error('Each message must be an object.');
    }

    if (entry.role !== 'user' && entry.role !== 'assistant') {
      throw new Error('Message role must be `user` or `assistant`.');
    }

    return {
      role: entry.role,
      content: normalizeContent(entry.role, entry.content)
    };
  });
}

function resolvePromptLanguage(language) {
  if (typeof language === 'string' && language.toLowerCase().startsWith('en')) {
    return 'en';
  }

  return 'fr';
}

function normalizePromptContext(body) {
  if (!isRecord(body)) {
    return {
      ok: true,
      artistId: DEFAULT_ARTIST_ID,
      modeId: DEFAULT_MODE_ID,
      language: 'fr-CA'
    };
  }

  const rawArtistId = typeof body.artistId === 'string' ? body.artistId.trim() : '';
  if (rawArtistId && !SUPPORTED_ARTIST_IDS.has(rawArtistId)) {
    return { ok: false, error: 'Unsupported artist.' };
  }

  const rawModeId = typeof body.modeId === 'string' ? body.modeId.trim() : '';
  const modeId = rawModeId && rawModeId.length <= 80 ? rawModeId : DEFAULT_MODE_ID;
  const rawLanguage = typeof body.language === 'string' ? body.language.trim() : '';
  const language = rawLanguage && rawLanguage.length <= 24 ? rawLanguage : 'fr-CA';

  return {
    ok: true,
    artistId: rawArtistId || DEFAULT_ARTIST_ID,
    modeId,
    language
  };
}

function normalizeProfileForPrompt(row) {
  if (!isRecord(row)) {
    return null;
  }

  const interests = Array.isArray(row.interests)
    ? row.interests.filter((value) => typeof value === 'string' && value.trim()).slice(0, 12)
    : [];

  return {
    age: typeof row.age === 'number' && Number.isFinite(row.age) ? Math.floor(row.age) : null,
    sex: typeof row.sex === 'string' ? row.sex : null,
    relationshipStatus: typeof row.relationship_status === 'string' ? row.relationship_status : null,
    horoscopeSign: typeof row.horoscope_sign === 'string' ? row.horoscope_sign : null,
    interests
  };
}

async function fetchUserProfileForPrompt(supabaseAdmin, userId, requestId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('age, sex, relationship_status, horoscope_sign, interests')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error(`[api/claude][${requestId}] Failed to fetch profile for prompt`, error);
    return null;
  }

  return normalizeProfileForPrompt(data);
}

function buildUserProfileSection(profile, promptLanguage) {
  if (!profile) {
    return '';
  }

  const sexLabels = promptLanguage === 'en' ? PROFILE_SEX_LABEL_EN : PROFILE_SEX_LABEL_FR;
  const statusLabels = promptLanguage === 'en' ? PROFILE_STATUS_LABEL_EN : PROFILE_STATUS_LABEL_FR;
  const lines = [];

  if (typeof profile.age === 'number') {
    lines.push(promptLanguage === 'en' ? `- Approximate age: ${profile.age}` : `- Age approximatif : ${profile.age} ans`);
  }

  if (profile.sex && sexLabels[profile.sex]) {
    lines.push(promptLanguage === 'en' ? `- Gender: ${sexLabels[profile.sex]}` : `- Genre : ${sexLabels[profile.sex]}`);
  }

  if (profile.relationshipStatus && statusLabels[profile.relationshipStatus]) {
    lines.push(
      promptLanguage === 'en'
        ? `- Relationship status: ${statusLabels[profile.relationshipStatus]}`
        : `- Statut : ${statusLabels[profile.relationshipStatus]}`
    );
  }

  if (typeof profile.horoscopeSign === 'string' && profile.horoscopeSign) {
    lines.push(
      promptLanguage === 'en'
        ? `- Horoscope sign: ${profile.horoscopeSign}`
        : `- Signe astro : ${profile.horoscopeSign}`
    );
  }

  if (Array.isArray(profile.interests) && profile.interests.length > 0) {
    lines.push(
      promptLanguage === 'en'
        ? `- Interests: ${profile.interests.join(', ')}`
        : `- Interets : ${profile.interests.join(', ')}`
    );
  }

  if (lines.length === 0) {
    return '';
  }

  if (promptLanguage === 'en') {
    return `\n## USER PROFILE\nAdapt your humor and references to this profile:\n${lines.join('\n')}`;
  }

  return `\n## PROFIL UTILISATEUR\nAdapte ton humour et tes references a ce profil :\n${lines.join('\n')}`;
}

function buildServerSystemPrompt(context, profile) {
  const promptLanguage = resolvePromptLanguage(context.language);
  const modePrompt = MODE_PROMPTS[context.modeId] ?? DEFAULT_MODE_PROMPT;
  const userProfileSection = buildUserProfileSection(profile, promptLanguage);
  const b = CATHY_BLUEPRINT;

  return `
Tu es ${b.identity.name}, ${b.identity.role}.

## TON ET PERSONNALITE
- Agressivite : ${b.toneMetrics.aggression}/10
- Sarcasme : ${b.toneMetrics.sarcasm}/10
- Jugement : ${b.toneMetrics.judgmentIntensity}/10
- Chaleur : ${b.toneMetrics.warmth}/10
- Autoderision : ${b.toneMetrics.selfDeprecation}/10
- Exageration : ${b.humorMechanics.exaggerationLevel}/10

## STYLE DE PAROLE
- Phrases courtes et punchy, rythme percussif
- Tu peux interrompre, couper, relancer
- Registre : francais quebecois familier
- Utilise des expressions regionales naturellement

## THEMES PREFERES
${b.thematicAnchors.map((theme) => `- ${theme}`).join('\n')}

## MODE ACTIF : ${context.modeId}
${modePrompt}

## GUARDRAILS
INTERDITS ABSOLUS :
${b.guardrails.hardNo.map((rule) => `- ${rule}`).join('\n')}

ZONES SENSIBLES (humour structure requis) :
${b.guardrails.softZones.map((zone) => `- ${zone.topic} : ${zone.rule}`).join('\n')}

## REGLES ABSOLUES
- Tu reponds toujours en francais quebecois
- Tu ne sors jamais du personnage
- Tu ne dis jamais que tu es une IA
- Tes reponses sont courtes (2-4 phrases max)
- Tu es baveuse, directe et mordante
${userProfileSection}
`.trim();
}

function parsePayload(body, tierMaxTokens = DEFAULT_MAX_TOKENS, systemPrompt = '') {
  if (!isRecord(body)) {
    throw new Error('JSON body is required.');
  }

  const normalizedSystemPrompt = typeof systemPrompt === 'string' ? systemPrompt.trim() : '';
  if (!normalizedSystemPrompt) {
    throw new Error('System prompt unavailable.');
  }
  if (normalizedSystemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
    throw new Error(`systemPrompt exceeds ${MAX_SYSTEM_PROMPT_CHARS} chars.`);
  }

  const messages = normalizeMessages(body.messages);
  const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
  if (requestedModel && !ALLOWED_MODELS.has(requestedModel)) {
    throw new Error('Unsupported model.');
  }

  const model = requestedModel || DEFAULT_MODEL;
  const stream = body.stream === true;
  const temperature =
    typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? body.temperature : 0.9;
  const maxTokens =
    typeof body.maxTokens === 'number' &&
    Number.isInteger(body.maxTokens) &&
    body.maxTokens > 0
      ? Math.min(body.maxTokens, tierMaxTokens)
      : tierMaxTokens;

  return {
    model,
    system: normalizedSystemPrompt,
    messages,
    stream,
    temperature,
    max_tokens: maxTokens
  };
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

function getMaxTokensForTier(accountType) {
  const normalizedAccountType = typeof accountType === 'string' && accountType.trim() ? accountType.trim() : 'free';
  return DEFAULT_MAX_TOKENS_BY_TIER[normalizedAccountType] ?? DEFAULT_MAX_TOKENS_BY_TIER.free;
}

function getRetryAfterUntilNextMonthSeconds() {
  const nextMonthStartMs = Date.parse(getNextMonthStartIso());
  return Math.max(1, Math.ceil((nextMonthStartMs - Date.now()) / 1000));
}

function getMonthlyQuotaCacheKey(userId, monthStartIso) {
  return `${userId}:${monthStartIso}`;
}

function getMonthlyQuotaFromCache(userId, monthStartIso) {
  const key = getMonthlyQuotaCacheKey(userId, monthStartIso);
  const cached = monthlyQuotaCache.get(key);
  if (!cached || Date.now() - cached.updatedAtMs > MONTHLY_QUOTA_CACHE_TTL_MS) {
    return null;
  }

  return cached.count;
}

function setMonthlyQuotaCache(userId, monthStartIso, count) {
  const key = getMonthlyQuotaCacheKey(userId, monthStartIso);
  monthlyQuotaCache.set(key, {
    count: Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0),
    updatedAtMs: Date.now()
  });
}

function incrementMonthlyQuotaCache(userId, monthStartIso) {
  const key = getMonthlyQuotaCacheKey(userId, monthStartIso);
  const cached = monthlyQuotaCache.get(key);
  if (!cached) {
    return;
  }

  monthlyQuotaCache.set(key, {
    count: cached.count + 1,
    updatedAtMs: Date.now()
  });
}

async function enforceMonthlyQuota(supabaseAdmin, userId, accountType, requestId) {
  const normalizedAccountType = typeof accountType === 'string' && accountType.trim() ? accountType.trim() : 'free';
  if (normalizedAccountType === 'admin') {
    return { ok: true };
  }

  const effectiveCap = getMonthlyCap(normalizedAccountType);
  const monthStartIso = getMonthStartIso();
  const cachedUsage = getMonthlyQuotaFromCache(userId, monthStartIso);
  if (cachedUsage !== null) {
    if (cachedUsage >= effectiveCap) {
      return {
        ok: false,
        status: 429,
        code: 'MONTHLY_QUOTA_EXCEEDED',
        message: `Monthly message quota exceeded. Limit: ${effectiveCap} messages.`
      };
    }

    return { ok: true };
  }

  const { count, error } = await supabaseAdmin
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('endpoint', 'claude')
    .gte('created_at', monthStartIso);

  if (error) {
    console.error(`[api/claude][${requestId}] Failed to read monthly usage`, error);
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

  setMonthlyQuotaCache(userId, monthStartIso, count ?? 0);

  return { ok: true };
}

async function enforceUserRateLimit(supabaseAdmin, userId, requestId) {
  const now = Date.now();
  const windowMs = parsePositiveInt(process.env.CLAUDE_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS);
  const maxRequests = parsePositiveInt(process.env.CLAUDE_RATE_LIMIT_MAX_REQUESTS, DEFAULT_RATE_LIMIT_MAX_REQUESTS);
  const windowStartIso = new Date(now - windowMs).toISOString();
  const nowIso = new Date(now).toISOString();

  const { count, error: countError } = await supabaseAdmin
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('endpoint', 'claude')
    .gte('created_at', windowStartIso);

  if (countError) {
    console.error(`[api/claude][${requestId}] Failed to read usage_events`, countError);
    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Rate limit store unavailable.'
    };
  }

  if ((count ?? 0) >= maxRequests) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded.',
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000))
    };
  }

  const { error: insertError } = await supabaseAdmin.from('usage_events').insert({
    user_id: userId,
    endpoint: 'claude',
    request_id: requestId,
    created_at: nowIso
  });

  if (insertError) {
    console.error(`[api/claude][${requestId}] Failed to write usage_events`, insertError);
    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Rate limit store unavailable.'
    };
  }

  incrementMonthlyQuotaCache(userId, getMonthStartIso());

  return { ok: true, retryAfterSeconds: 0 };
}

async function relaySseResponse(upstreamResponse, res, requestId) {
  const reader = upstreamResponse.body?.getReader();
  if (!reader) {
    sendError(res, 502, 'No streaming body from Anthropic.', { code: 'UPSTREAM_STREAM_MISSING', requestId });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (error) {
    console.error(`[api/claude][${requestId}] SSE relay failed`, error);
    res.end();
  }
}

function getErrorMessage(payload) {
  if (typeof payload === 'string' && payload) {
    return payload;
  }

  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.message === 'string' &&
    payload.error.message
  ) {
    return payload.error.message;
  }

  return 'Upstream API error';
}

async function validateAuthHeader(supabaseAdmin, req, requestId) {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    return { userId: null, error: 'No token' };
  }

  if (!supabaseAdmin) {
    return { userId: null, error: 'Supabase admin client unavailable' };
  }

  try {
    const {
      data: { user },
      error
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return { userId: null, error: error?.message ?? 'Invalid token' };
    }

    return {
      userId: user.id,
      role: typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : null,
      accountType: typeof user.app_metadata?.account_type === 'string' ? user.app_metadata.account_type : null,
      error: null
    };
  } catch (error) {
    console.error(`[api/claude][${requestId}] Token validation failed`, error);
    return { userId: null, error: 'Token validation failed' };
  }
}

module.exports = async function handler(req, res) {
  const requestId = attachRequestId(req, res);
  const supabaseAdmin = getSupabaseAdmin();
  const corsResult = setCorsHeaders(req, res);
  if (!corsResult.ok) {
    if (corsResult.reason === 'cors_not_configured') {
      sendError(res, 500, 'Server misconfigured: ALLOWED_ORIGINS missing.', {
        code: 'SERVER_MISCONFIGURED',
        requestId
      });
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
    console.error(`[api/claude][${requestId}] Missing env vars: ${missingEnv.join(', ')}`);
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  const auth = await validateAuthHeader(supabaseAdmin, req, requestId);
  if (auth.error) {
    sendError(res, 401, 'Unauthorized.', { code: 'UNAUTHORIZED', requestId });
    return;
  }

  const monthlyQuota = await enforceMonthlyQuota(supabaseAdmin, auth.userId, auth.accountType, requestId);
  if (!monthlyQuota.ok) {
    if (monthlyQuota.status === 429) {
      res.setHeader('Retry-After', String(getRetryAfterUntilNextMonthSeconds()));
    }
    sendError(res, monthlyQuota.status, monthlyQuota.message, { code: monthlyQuota.code, requestId });
    return;
  }

  const rateLimit = await enforceUserRateLimit(supabaseAdmin, auth.userId, requestId);
  if (!rateLimit.ok) {
    if (rateLimit.status === 429) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
    }
    sendError(res, rateLimit.status, rateLimit.message, { code: rateLimit.code, requestId });
    return;
  }

  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!apiKey) {
    sendError(res, 500, 'Server misconfigured: ANTHROPIC_API_KEY missing.', {
      code: 'SERVER_MISCONFIGURED',
      requestId
    });
    return;
  }

  const tierMaxTokens = getMaxTokensForTier(auth.accountType);
  const promptContext = normalizePromptContext(req.body);
  if (!promptContext.ok) {
    sendError(res, 400, promptContext.error, { code: 'INVALID_REQUEST', requestId });
    return;
  }

  const profileForPrompt = await fetchUserProfileForPrompt(supabaseAdmin, auth.userId, requestId);
  const serverSystemPrompt = buildServerSystemPrompt(promptContext, profileForPrompt);

  let payload;
  try {
    payload = parsePayload(req.body, tierMaxTokens, serverSystemPrompt);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request payload.';
    sendError(res, 400, message, { code: 'INVALID_REQUEST', requestId });
    return;
  }

  let upstreamResponse;
  const fetchTimeoutMs = parsePositiveInt(process.env.ANTHROPIC_FETCH_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS);
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), fetchTimeoutMs);
  try {
    upstreamResponse = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(payload),
      signal: timeoutController.signal
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      sendError(res, 504, 'Anthropic API timed out.', { code: 'UPSTREAM_TIMEOUT', requestId });
      return;
    }

    console.error(`[api/claude][${requestId}] Failed to reach Anthropic`, error);
    sendError(res, 502, 'Failed to reach Anthropic API.', { code: 'UPSTREAM_UNREACHABLE', requestId });
    return;
  } finally {
    clearTimeout(timeout);
  }

  if (!upstreamResponse.ok) {
    let upstreamError;
    try {
      upstreamError = await upstreamResponse.json();
    } catch {
      upstreamError = await upstreamResponse.text();
    }

    sendError(res, upstreamResponse.status, getErrorMessage(upstreamError), {
      code: 'UPSTREAM_ERROR',
      requestId
    });
    return;
  }

  if (payload.stream) {
    await relaySseResponse(upstreamResponse, res, requestId);
    return;
  }

  let responseBody;
  try {
    responseBody = await upstreamResponse.json();
  } catch (error) {
    console.error(`[api/claude][${requestId}] Invalid upstream JSON`, error);
    sendError(res, 502, 'Invalid JSON from Anthropic API.', { code: 'UPSTREAM_INVALID_JSON', requestId });
    return;
  }

  res.status(200).json(responseBody);
};
