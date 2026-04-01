const { randomUUID } = require('node:crypto');
const {
  extractBearerToken,
  getMissingEnv,
  getSupabaseAdmin,
  sendError,
  setCorsHeaders,
  attachRequestId
} = require('./_utils');
const {
  normalizeImageInput,
  normalizeCaption,
  normalizePlacement,
  renderMemeImage
} = require('./_meme-render');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_CAPTION_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_CAPTION_TOKENS = 160;
const MAX_INPUT_TEXT_CHARS = 280;

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function normalizeLanguage(value) {
  if (typeof value !== 'string') {
    return 'fr-CA';
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 'fr-CA';
  }

  return normalized.startsWith('en') ? 'en-CA' : 'fr-CA';
}

function normalizeAction(value) {
  if (value === 'propose' || value === 'finalize') {
    return value;
  }

  throw new Error('action must be "propose" or "finalize".');
}

function normalizeOptionalText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_INPUT_TEXT_CHARS);
}

function sanitizeCaption(value) {
  const normalized = normalizeCaption(value);
  if (!normalized) {
    return '';
  }

  return normalized.slice(0, 80);
}

function extractAnthropicText(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    return '';
  }

  return payload.content
    .filter((entry) => isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text)
    .join('\n')
    .trim();
}

function extractJsonFromText(rawText) {
  if (typeof rawText !== 'string') {
    return null;
  }

  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch && fencedMatch[1] ? fencedMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

function fallbackCaptions(language) {
  const isEnglish = language.toLowerCase().startsWith('en');
  return isEnglish
    ? [
        'Me pretending this is totally under control',
        'When your brain opens 37 tabs at once',
        'POV: confidence in public, chaos at home'
      ]
    : [
        "Moi qui fais semblant d'avoir la situation en main",
        'Quand ton cerveau ouvre 37 onglets en meme temps',
        'POV: confiante en public, chaos a la maison'
      ];
}

function parseCaptionCandidates(rawText, language) {
  const fromJson = extractJsonFromText(rawText);
  const list =
    (isRecord(fromJson) && Array.isArray(fromJson.captions) ? fromJson.captions : null) ??
    (Array.isArray(fromJson) ? fromJson : null);

  const normalized = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      if (typeof item !== 'string') {
        continue;
      }
      const cleaned = sanitizeCaption(item.replace(/^\s*(?:\d+[.)]|[-*])\s*/, ''));
      if (!cleaned || normalized.includes(cleaned)) {
        continue;
      }
      normalized.push(cleaned);
      if (normalized.length >= 3) {
        break;
      }
    }
  }

  if (normalized.length < 3) {
    const loose = rawText
      .split(/\n+/)
      .map((line) => sanitizeCaption(line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '')))
      .filter(Boolean);
    for (const candidate of loose) {
      if (normalized.includes(candidate)) {
        continue;
      }
      normalized.push(candidate);
      if (normalized.length >= 3) {
        break;
      }
    }
  }

  if (normalized.length < 3) {
    for (const fallback of fallbackCaptions(language)) {
      const cleaned = sanitizeCaption(fallback);
      if (!cleaned || normalized.includes(cleaned)) {
        continue;
      }
      normalized.push(cleaned);
      if (normalized.length >= 3) {
        break;
      }
    }
  }

  return normalized.slice(0, 3);
}

function resolvePlacements() {
  return ['top', 'bottom', 'top'];
}

async function generateCaptionOptions({ image, language, promptText, requestId }) {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('Server misconfigured: ANTHROPIC_API_KEY missing.');
  }

  const systemPrompt = language.toLowerCase().startsWith('en')
    ? `You are Cathy Gauthier writing meme captions.
Return STRICT JSON only, no prose:
{"captions":["caption 1","caption 2","caption 3"]}
Rules:
- Exactly 3 captions
- Max 80 characters each
- Short, funny, sharable, and grounded in the uploaded image
- No numbering, no emojis-only answers, no markdown`
    : `Tu es Cathy Gauthier et tu crees des captions de meme.
Retourne STRICTEMENT du JSON, sans texte autour :
{"captions":["caption 1","caption 2","caption 3"]}
Regles:
- Exactement 3 captions
- Maximum 80 caracteres chacune
- Courtes, droles, partageables, liees a l'image
- Aucune numerotation, aucun markdown`;

  const userText = promptText
    ? language.toLowerCase().startsWith('en')
      ? `User context: ${promptText}`
      : `Contexte utilisateur: ${promptText}`
    : language.toLowerCase().startsWith('en')
      ? 'Create 3 meme captions from this image.'
      : 'Cree 3 captions de meme pour cette image.';

  const controller = new AbortController();
  const timeoutMs = Number.parseInt(process.env.ANTHROPIC_FETCH_TIMEOUT_MS ?? '', 10);
  const safeTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_FETCH_TIMEOUT_MS;
  const timeoutHandle = setTimeout(() => controller.abort(), safeTimeout);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: (process.env.MEME_CAPTION_MODEL ?? '').trim() || DEFAULT_CAPTION_MODEL,
        max_tokens: DEFAULT_MAX_CAPTION_TOKENS,
        temperature: 0.55,
        stream: false,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: userText
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: image.mediaType,
                  data: image.base64
                }
              }
            ]
          }
        ]
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const upstreamMessage =
        isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string'
          ? payload.error.message
          : 'Caption generation failed.';
      const error = new Error(upstreamMessage);
      error.status = response.status;
      throw error;
    }

    const parsed = parseCaptionCandidates(extractAnthropicText(payload), language);
    if (parsed.length < 3) {
      throw new Error('Caption generation returned insufficient options.');
    }

    return parsed;
  } catch (error) {
    if (isRecord(error) && error.name === 'AbortError') {
      const timeoutError = new Error('Caption generation timed out.');
      timeoutError.code = 'UPSTREAM_TIMEOUT';
      timeoutError.status = 504;
      throw timeoutError;
    }

    console.error(`[api/meme-generator][${requestId}] Caption generation failed`, error);
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function parseProposePayload(body) {
  if (!isRecord(body)) {
    throw new Error('JSON body is required.');
  }

  const language = normalizeLanguage(body.language);
  const image = normalizeImageInput(body.image);
  const promptText = normalizeOptionalText(body.text);

  return {
    language,
    image,
    promptText
  };
}

function parseFinalizePayload(body) {
  if (!isRecord(body)) {
    throw new Error('JSON body is required.');
  }

  const language = normalizeLanguage(body.language);
  const image = normalizeImageInput(body.image);
  const caption = sanitizeCaption(body.caption);
  if (!caption) {
    throw new Error('caption is required for finalize.');
  }

  return {
    language,
    image,
    caption,
    placement: normalizePlacement(body.placement)
  };
}

async function validateAuthToken(supabaseAdmin, authorizationHeader) {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    return { ok: false };
  }

  const {
    data: { user },
    error
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return { ok: false };
  }

  return {
    ok: true,
    userId: user.id
  };
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

  const auth = await validateAuthToken(supabaseAdmin, req.headers.authorization);
  if (!auth.ok) {
    sendError(res, 401, 'Unauthorized.', { code: 'UNAUTHORIZED', requestId });
    return;
  }

  let action;
  try {
    action = normalizeAction(req.body?.action);
  } catch (error) {
    sendError(res, 400, error instanceof Error ? error.message : 'Invalid payload.', {
      code: 'INVALID_REQUEST',
      requestId
    });
    return;
  }

  if (action === 'propose' && getMissingEnv(['ANTHROPIC_API_KEY']).length > 0) {
    sendError(res, 500, 'Server misconfigured.', { code: 'SERVER_MISCONFIGURED', requestId });
    return;
  }

  try {
    if (action === 'propose') {
      const payload = parseProposePayload(req.body);
      const captions = await generateCaptionOptions({
        image: payload.image,
        language: payload.language,
        promptText: payload.promptText,
        requestId
      });
      const placements = resolvePlacements();
      const draftId = randomUUID();

      const options = [];
      for (let index = 0; index < captions.length; index += 1) {
        const caption = captions[index];
        const placement = placements[index] ?? 'top';
        const rendered = await renderMemeImage({
          image: payload.image,
          caption,
          placement
        });

        options.push({
          optionId: `meme_opt_${index + 1}`,
          caption,
          placement,
          logoPlacement: rendered.logoPlacement,
          previewImageBase64: rendered.base64,
          mimeType: rendered.mimeType,
          previewMimeType: rendered.mimeType
        });
      }

      res.status(200).json({
        draftId,
        options
      });
      return;
    }

    const payload = parseFinalizePayload(req.body);
    const rendered = await renderMemeImage({
      image: payload.image,
      caption: payload.caption,
      placement: payload.placement
    });

    res.status(200).json({
      imageBase64: rendered.base64,
      mimeType: rendered.mimeType,
      caption: payload.caption,
      placement: payload.placement,
      logoPlacement: rendered.logoPlacement
    });
  } catch (error) {
    if (isRecord(error) && error.code === 'UPSTREAM_TIMEOUT') {
      sendError(res, 504, 'Caption generation timed out.', {
        code: 'UPSTREAM_TIMEOUT',
        requestId,
        error
      });
      return;
    }

    const status =
      isRecord(error) && typeof error.status === 'number' && error.status >= 400 && error.status <= 599
        ? error.status
        : 400;
    const message = error instanceof Error && error.message ? error.message : 'Unable to generate meme.';
    const code = status >= 500 ? 'UPSTREAM_ERROR' : 'INVALID_REQUEST';

    sendError(res, status, message, {
      code,
      requestId,
      error
    });
  }
};
