const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const SUMMARY_MODEL = 'claude-haiku-4-5-20251001';
const SUMMARY_MAX_TOKENS = 160;
const SUMMARY_TEMPERATURE = 0.2;
const SUMMARY_FETCH_TIMEOUT_MS = 20_000;
const MAX_ARTIST_ID_CHARS = 80;
const MAX_SUMMARY_CHARS = 320;
const MAX_KEY_FACTS = 12;
const MAX_KEY_FACT_CHARS = 90;
const MAX_EXCERPT_MESSAGES = 28;
const MAX_EXCERPT_MESSAGE_CHARS = 280;

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

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeLanguage(value) {
  if (typeof value !== 'string') {
    return 'fr-CA';
  }

  return value.trim().toLowerCase().startsWith('en') ? 'en-CA' : 'fr-CA';
}

function normalizeSourceUserTurnCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeKeyFacts(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const fact = normalizeText(candidate, MAX_KEY_FACT_CHARS);
    if (!fact) {
      continue;
    }
    const key = fact.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(fact);
    if (normalized.length >= MAX_KEY_FACTS) {
      break;
    }
  }

  return normalized;
}

function normalizeExcerptMessages(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue;
    }

    const role = candidate.role === 'assistant' ? 'assistant' : candidate.role === 'user' ? 'user' : null;
    if (!role) {
      continue;
    }

    const content = normalizeText(candidate.content, MAX_EXCERPT_MESSAGE_CHARS);
    if (!content) {
      continue;
    }

    normalized.push({ role, content });
    if (normalized.length >= MAX_EXCERPT_MESSAGES) {
      break;
    }
  }

  return normalized;
}

function parsePayload(body) {
  if (!isRecord(body)) {
    throw new Error('JSON body is required.');
  }

  const artistId = normalizeText(body.artistId, MAX_ARTIST_ID_CHARS);
  if (!artistId) {
    throw new Error('artistId is required.');
  }

  const excerptMessages = normalizeExcerptMessages(body.excerptMessages);
  if (excerptMessages.length === 0) {
    throw new Error('excerptMessages must contain at least one valid message.');
  }

  return {
    artistId,
    language: normalizeLanguage(body.language),
    currentSummary: normalizeText(body.currentSummary, MAX_SUMMARY_CHARS),
    currentKeyFacts: normalizeKeyFacts(body.currentKeyFacts),
    sourceUserTurnCount: normalizeSourceUserTurnCount(body.sourceUserTurnCount),
    excerptMessages
  };
}

function buildSystemPrompt(language) {
  if (language.startsWith('en')) {
    return `You compress conversation memory for a relationship thread.
Return ONLY valid JSON with this exact shape:
{
  "summary": "string",
  "keyFacts": ["string"]
}
Rules:
- summary max ${MAX_SUMMARY_CHARS} chars.
- keyFacts max ${MAX_KEY_FACTS} entries.
- each key fact max ${MAX_KEY_FACT_CHARS} chars.
- keep stable identity facts, preferences, life context, and ongoing goals.
- remove redundant/noisy details.
- preserve recent corrections over older conflicting details.
- never include markdown, code fences, or extra keys.`;
  }

  return `Tu compresse la memoire relationnelle d'un thread principal.
Retourne UNIQUEMENT un JSON valide avec cette forme exacte:
{
  "summary": "string",
  "keyFacts": ["string"]
}
Regles:
- summary max ${MAX_SUMMARY_CHARS} caracteres.
- keyFacts max ${MAX_KEY_FACTS} elements.
- chaque key fact max ${MAX_KEY_FACT_CHARS} caracteres.
- garde les faits identitaires stables, preferences, contexte de vie, objectifs en cours.
- retire le bruit et les repetitions.
- privilegie les infos recentes quand il y a contradiction.
- aucun markdown, aucune balise, aucune cle additionnelle.`;
}

function buildUserPrompt(input) {
  const lines = input.excerptMessages.map((message) => `${message.role === 'user' ? 'USER' : 'ASSISTANT'}: ${message.content}`);
  const currentSummary = input.currentSummary || '(empty)';
  const currentFacts = input.currentKeyFacts.length > 0 ? input.currentKeyFacts.map((fact) => `- ${fact}`).join('\n') : '- (none)';

  return `Current summary:
${currentSummary}

Current key facts:
${currentFacts}

Recent excerpt:
${lines.join('\n')}

sourceUserTurnCount: ${input.sourceUserTurnCount}`;
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

function parseSummaryPayload(rawText, fallbackSummary, fallbackFacts) {
  const text = stripCodeFences(rawText);
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    const extracted = extractJsonObject(text);
    if (!extracted) {
      throw new Error('Summary response is not valid JSON.');
    }
    payload = JSON.parse(extracted);
  }

  if (!isRecord(payload)) {
    throw new Error('Summary response has invalid shape.');
  }

  const summary = normalizeText(payload.summary, MAX_SUMMARY_CHARS);
  const keyFacts = normalizeKeyFacts(payload.keyFacts);
  const safeSummary =
    summary ||
    normalizeText(fallbackSummary, MAX_SUMMARY_CHARS) ||
    (keyFacts.length > 0 ? keyFacts.slice(0, 2).join(' | ').slice(0, MAX_SUMMARY_CHARS) : '');
  const safeFacts = keyFacts.length > 0 ? keyFacts : normalizeKeyFacts(fallbackFacts);

  if (!safeSummary && safeFacts.length === 0) {
    throw new Error('Summary response is empty.');
  }

  return {
    summary: safeSummary,
    keyFacts: safeFacts
  };
}

async function callSummarizer(input, apiKey) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), SUMMARY_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        max_tokens: SUMMARY_MAX_TOKENS,
        temperature: SUMMARY_TEMPERATURE,
        stream: false,
        system: buildSystemPrompt(input.language),
        messages: [{ role: 'user', content: buildUserPrompt(input) }]
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string'
          ? payload.error.message
          : `Anthropic request failed with status ${response.status}.`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    const text = extractResponseText(payload);
    return parseSummaryPayload(text, input.currentSummary, input.currentKeyFacts);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function normalizeOutputRow(row, fallback) {
  if (!isRecord(row)) {
    return {
      artistId: fallback.artistId,
      summary: fallback.summary,
      keyFacts: fallback.keyFacts,
      sourceUserTurnCount: fallback.sourceUserTurnCount,
      updatedAt: new Date().toISOString()
    };
  }

  return {
    artistId: normalizeText(row.artist_id, MAX_ARTIST_ID_CHARS) || fallback.artistId,
    summary: normalizeText(row.summary, MAX_SUMMARY_CHARS) || fallback.summary,
    keyFacts: normalizeKeyFacts(row.key_facts),
    sourceUserTurnCount:
      typeof row.source_user_turn_count === 'number' && Number.isFinite(row.source_user_turn_count)
        ? Math.max(0, Math.floor(row.source_user_turn_count))
        : fallback.sourceUserTurnCount,
    updatedAt: typeof row.updated_at === 'string' && row.updated_at.trim() ? row.updated_at : new Date().toISOString()
  };
}

module.exports = async function handler(req, res) {
  const requestId = attachRequestId(req, res);
  const cors = setCorsHeaders(req, res, { methods: 'POST, OPTIONS' });
  if (!cors.ok) {
    if (cors.reason === 'cors_not_configured') {
      sendError(res, 500, 'Server misconfigured: ALLOWED_ORIGINS is required for browser requests.', {
        code: 'SERVER_MISCONFIGURED',
        requestId,
        scope: 'api/memory-summarize'
      });
      return;
    }
    sendError(res, 403, 'Origin not allowed.', {
      code: 'ORIGIN_FORBIDDEN',
      requestId,
      scope: 'api/memory-summarize'
    });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    sendError(res, 405, 'Method not allowed.', {
      code: 'METHOD_NOT_ALLOWED',
      requestId
    });
    return;
  }

  const missingEnv = getMissingEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY']);
  if (missingEnv.length > 0) {
    sendError(res, 500, `Server misconfigured: missing ${missingEnv.join(', ')}.`, {
      code: 'SERVER_MISCONFIGURED',
      requestId,
      scope: 'api/memory-summarize'
    });
    return;
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    sendError(res, 500, 'Server misconfigured: Supabase admin client unavailable.', {
      code: 'SERVER_MISCONFIGURED',
      requestId,
      scope: 'api/memory-summarize'
    });
    return;
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    sendError(res, 401, 'Unauthorized.', {
      code: 'UNAUTHORIZED',
      requestId
    });
    return;
  }

  let parsedPayload;
  try {
    parsedPayload = parsePayload(req.body);
  } catch (error) {
    sendError(res, 400, error instanceof Error ? error.message : 'Invalid request payload.', {
      code: 'INVALID_REQUEST',
      requestId
    });
    return;
  }

  try {
    const authLookup = await supabaseAdmin.auth.getUser(token);
    const authUser = authLookup?.data?.user ?? null;
    if (!authUser || authLookup.error) {
      sendError(res, 401, 'Unauthorized.', {
        code: 'UNAUTHORIZED',
        requestId
      });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY.trim();
    const summarized = await callSummarizer(parsedPayload, apiKey);
    const rowPayload = {
      user_id: authUser.id,
      artist_id: parsedPayload.artistId,
      summary: summarized.summary,
      key_facts: summarized.keyFacts,
      source_user_turn_count: parsedPayload.sourceUserTurnCount,
      updated_at: new Date().toISOString()
    };

    const upsertResult = await supabaseAdmin
      .from('relationship_memories')
      .upsert(rowPayload, { onConflict: 'user_id,artist_id' })
      .select('artist_id, summary, key_facts, source_user_turn_count, updated_at')
      .maybeSingle();

    if (upsertResult.error) {
      throw upsertResult.error;
    }

    const memory = normalizeOutputRow(upsertResult.data, {
      artistId: parsedPayload.artistId,
      summary: summarized.summary,
      keyFacts: summarized.keyFacts,
      sourceUserTurnCount: parsedPayload.sourceUserTurnCount
    });

    res.status(200).json({ memory });
  } catch (error) {
    const status = isRecord(error) && Number.isFinite(error.status) ? error.status : 500;
    const code = status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
    const message = error instanceof Error ? error.message : 'Unable to summarize relationship memory.';
    sendError(res, status, message, {
      code,
      requestId,
      scope: 'api/memory-summarize',
      error
    });
  }
};
