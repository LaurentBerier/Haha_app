const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
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
const {
  enforceMonthlyQuota,
  getRetryAfterUntilNextMonthSeconds,
  parsePositiveInt,
  recordUsageEvent,
  writeProfileMonthlyCounter
} = require('./_quota-utils');
const { resolveEffectiveAccountType } = require('./_account-tier');

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function sanitizeString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function parsePayload(body) {
  if (!isRecord(body)) {
    throw new Error('JSON body is required.');
  }

  const artistId = sanitizeString(body.artistId, 60);
  if (!artistId) {
    throw new Error('artistId is required.');
  }

  const language =
    typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'fr-CA';

  const theme = isRecord(body.theme)
    ? {
        id: sanitizeString(body.theme.id, 20),
        label: sanitizeString(body.theme.label, 60),
        emoji: sanitizeString(body.theme.emoji, 8)
      }
    : null;

  const cards = Array.isArray(body.cards)
    ? body.cards
        .filter((c) => isRecord(c))
        .map((c) => ({
          name: sanitizeString(c.name, 60),
          emoji: sanitizeString(c.emoji, 8)
        }))
        .filter((c) => Boolean(c.name))
        .slice(0, 3)
    : [];

  if (cards.length !== 3) {
    throw new Error('Exactly 3 cards are required.');
  }

  const userProfile = isRecord(body.userProfile)
    ? {
        preferredName: sanitizeString(body.userProfile.preferredName, 40) || null,
        age: typeof body.userProfile.age === 'number' ? Math.floor(body.userProfile.age) : null,
        sex: sanitizeString(body.userProfile.sex, 30) || null,
        relationshipStatus: sanitizeString(body.userProfile.relationshipStatus, 30) || null,
        horoscopeSign: sanitizeString(body.userProfile.horoscopeSign, 30) || null,
        interests: Array.isArray(body.userProfile.interests)
          ? body.userProfile.interests
              .filter((i) => typeof i === 'string')
              .map((i) => i.trim().slice(0, 40))
              .filter(Boolean)
              .slice(0, 10)
          : []
      }
    : null;

  const memoryFacts = Array.isArray(body.memoryFacts)
    ? body.memoryFacts
        .filter((f) => typeof f === 'string')
        .map((f) => f.trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 6)
    : [];

  return { artistId, language, theme, cards, userProfile, memoryFacts };
}

function buildTarotSystemPrompt() {
  return `Tu es Cathy Gauthier, humoriste québécoise. Tu fais un tirage de tarot court, punchant et personnalisé.

TON: Direct, chaleureux, mordant. Comme une tante qui t'aime mais qui te ménage pas.
LONGUEUR: Chaque interprétation = 2 phrases MAXIMUM. Grand finale = 1 phrase avec une vraie chute. Sois bref, dense, percutant.
HUMOUR: Québécois authentique. Les sacres (câline, crisse, ostie) sont acceptés SEULEMENT quand ils renforcent naturellement la phrase, comme un vrai punch. Ne les place jamais au hasard ou en milieu de phrase pour couper le sens.
EXEMPLE MAUVAIS: "La Tour, c'est la carte du ostie de crash - et dans ton amour, ça"
EXEMPLE BON: "La Tour, c'est la carte qui représente un crash dans ton amour, un ostie de crash!"
LANGUE: Anglicismes naturalisés OK (parké, busté, ghosté, checker, rusher). Jamais d'adjectifs ou noms anglais bruts à la place du français (pas "big", pas "single", pas "nice").
RÈGLE: Jamais de tiret long (—) ni de guillemets droits dans les textes. Jamais de sérieux mystique. Toujours ancrer dans le quotidien.
THÈME: Chaque carte est interprétée UNIQUEMENT selon le thème choisi par l'utilisateur.
PERSONNALISATION: Utilise le profil et les faits mémorisés pour viser juste. Sans profil, reste universel et québécois.

FORMAT OBLIGATOIRE: retourne UNIQUEMENT ce JSON valide, sans texte avant ou après, sans balises markdown:
{
  "readings": [
    {"cardName": "Nom de la carte 1", "emoji": "emoji1", "interpretation": "Texte court sans guillemets internes."},
    {"cardName": "Nom de la carte 2", "emoji": "emoji2", "interpretation": "Texte court sans guillemets internes."},
    {"cardName": "Nom de la carte 3", "emoji": "emoji3", "interpretation": "Texte court sans guillemets internes."}
  ],
  "grandFinale": "Une phrase de chute sans guillemets internes."
}

IMPORTANT JSON: N'utilise jamais de guillemets droits (") à l'intérieur des valeurs. Utilise des apostrophes courbes ou reformule. Le JSON doit être parseable tel quel.`;
}

function buildTarotUserPrompt(input) {
  const { theme, cards, userProfile, memoryFacts, language } = input;

  const themeStr = theme ? `${theme.emoji} ${theme.label}` : 'Général';
  const cardsStr = cards.map((c) => `${c.name} ${c.emoji}`).join(', ');

  let prompt = `Thème du tirage: ${themeStr}\nCartes choisies: ${cardsStr}\nLangue: ${language}`;

  if (userProfile) {
    const profileLines = [];
    if (userProfile.preferredName) profileLines.push(`- Prénom: ${userProfile.preferredName}`);
    if (userProfile.age) profileLines.push(`- Âge: ${userProfile.age} ans`);
    if (userProfile.sex) profileLines.push(`- Genre: ${userProfile.sex}`);
    if (userProfile.relationshipStatus) profileLines.push(`- Statut: ${userProfile.relationshipStatus}`);
    if (userProfile.horoscopeSign) profileLines.push(`- Signe: ${userProfile.horoscopeSign}`);
    if (userProfile.interests.length > 0) {
      profileLines.push(`- Intérêts: ${userProfile.interests.join(', ')}`);
    }
    if (profileLines.length > 0) {
      prompt += `\n\nProfil de l'utilisateur:\n${profileLines.join('\n')}`;
    }
  }

  if (memoryFacts.length > 0) {
    prompt += `\n\nCe que je sais déjà de cet utilisateur (tiré de nos conversations):\n${memoryFacts.map((f) => `- ${f}`).join('\n')}`;
  }

  return prompt;
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

function parseTarotPayload(rawText) {
  const text = stripCodeFences(rawText);
  let payload = null;

  try {
    payload = JSON.parse(text);
  } catch {
    const extracted = extractJsonObject(text);
    if (!extracted) {
      throw new Error('Tarot response is not valid JSON.');
    }
    payload = JSON.parse(extracted);
  }

  if (!isRecord(payload) || !Array.isArray(payload.readings)) {
    throw new Error('Tarot response has invalid shape.');
  }

  const readings = payload.readings
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      cardName: typeof entry.cardName === 'string' ? entry.cardName.trim().slice(0, 60) : '',
      emoji: typeof entry.emoji === 'string' ? entry.emoji.trim().slice(0, 8) : '',
      interpretation:
        typeof entry.interpretation === 'string' ? entry.interpretation.trim().slice(0, 280) : ''
    }))
    .filter((entry) => Boolean(entry.cardName) && Boolean(entry.interpretation))
    .slice(0, 3);

  if (readings.length !== 3) {
    throw new Error('Tarot response must contain exactly 3 readings.');
  }

  const grandFinale =
    typeof payload.grandFinale === 'string' && payload.grandFinale.trim()
      ? payload.grandFinale.trim().slice(0, 160)
      : 'Les cartes ont parlé. Bonne chance.';

  return { readings, grandFinale };
}

async function callTarotModelOnce(input, signal) {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: 600,
      temperature: 0.92,
      stream: false,
      system: buildTarotSystemPrompt(),
      messages: [{ role: 'user', content: buildTarotUserPrompt(input) }]
    }),
    signal
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      isRecord(payload) &&
      isRecord(payload.error) &&
      typeof payload.error.message === 'string' &&
      payload.error.message
        ? payload.error.message
        : 'Tarot generation failed.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const rawText = extractResponseText(payload);
  if (!rawText.trim()) {
    throw new Error('Tarot response is empty.');
  }

  return parseTarotPayload(rawText);
}

async function callTarotModel(input) {
  const timeoutMs = parsePositiveInt(process.env.ANTHROPIC_FETCH_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const MAX_ATTEMPTS = 2;
  let lastParseError = null;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await callTarotModelOnce(input, controller.signal);
      } catch (error) {
        const isParseError =
          error instanceof Error &&
          (error.message.includes('not valid JSON') ||
            error.message.includes('invalid shape') ||
            error.message.includes('exactly 3 readings'));

        if (isParseError && attempt < MAX_ATTEMPTS) {
          lastParseError = error;
          continue;
        }

        // Non-parse error or last attempt — re-throw as-is (upstream / network errors)
        if (!isParseError) {
          throw error;
        }

        // Last attempt and still a parse error
        const parseError = new Error(error.message);
        parseError.code = 'TAROT_PARSE_FAILED';
        throw parseError;
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  // Should never reach here, but satisfy linter
  const finalError = new Error(lastParseError?.message ?? 'Tarot parse failed.');
  finalError.code = 'TAROT_PARSE_FAILED';
  throw finalError;
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
    logPrefix: 'api/tarot-reading',
    usageEndpoints: ['claude', 'game-questions', 'game-judge', 'tarot-reading']
  });
  if (!monthlyQuota.ok) {
    if (monthlyQuota.status === 429) {
      res.setHeader('Retry-After', String(getRetryAfterUntilNextMonthSeconds()));
    }
    sendError(res, monthlyQuota.status, monthlyQuota.message, { code: monthlyQuota.code, requestId });
    return;
  }

  let tarotResult;
  try {
    tarotResult = await callTarotModel(input);
  } catch (error) {
    if (isRecord(error) && error.code === 'TAROT_PARSE_FAILED') {
      sendError(res, 422, 'Tarot output is invalid.', { code: 'TAROT_PARSE_FAILED', requestId });
      return;
    }
    const message =
      error instanceof Error && error.message ? error.message : 'Tarot generator unavailable.';
    sendError(res, 502, message, { code: 'UPSTREAM_ERROR', requestId });
    return;
  }

  const usageInsert = await recordUsageEvent({
    supabaseAdmin,
    userId: user.id,
    endpoint: 'tarot-reading',
    requestId
  });
  if (!usageInsert.ok) {
    console.error(`[api/tarot-reading][${requestId}] Failed to write usage_events`, usageInsert.error);
    sendError(res, 500, 'Usage store unavailable.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  if (monthlyQuota.source === 'profile') {
    const used =
      typeof monthlyQuota.used === 'number' && Number.isFinite(monthlyQuota.used)
        ? monthlyQuota.used
        : 0;
    const counterUpdate = await writeProfileMonthlyCounter(
      supabaseAdmin,
      user.id,
      monthlyQuota.monthStartIso,
      used + 1,
      requestId,
      'api/tarot-reading'
    );

    if (!counterUpdate.ok) {
      sendError(res, 500, 'Usage store unavailable.', { code: 'SERVER_MISCONFIGURED', requestId });
      return;
    }
  }

  res.status(200).json(tarotResult);
};
