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
const DEFAULT_ANALYSIS_MODEL = DEFAULT_CAPTION_MODEL;
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_CAPTION_TOKENS = 160;
const DEFAULT_MAX_ANALYSIS_TOKENS = 300;
const MAX_INPUT_TEXT_CHARS = 280;
const HIGH_CONFIDENCE_CELEBRITY_THRESHOLD = 0.85;
const FRENCH_ACCENT_WORD_MAP = new Map([
  ['meme', 'mème'],
  ['memes', 'mèmes'],
  ['tres', 'très'],
  ['deja', 'déjà'],
  ['apres', 'après'],
  ['voila', 'voilà'],
  ['etre', 'être'],
  ['ca', 'ça'],
  ['drole', 'drôle'],
  ['droles', 'drôles']
]);

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

function applyWordCase(referenceWord, replacementWord) {
  const safeReference = String(referenceWord ?? '');
  const safeReplacement = String(replacementWord ?? '');
  if (!safeReference || !safeReplacement) {
    return safeReplacement;
  }

  if (safeReference === safeReference.toUpperCase()) {
    return safeReplacement.toUpperCase();
  }

  const startsUppercase = safeReference[0] === safeReference[0].toUpperCase();
  if (startsUppercase) {
    return safeReplacement[0].toUpperCase() + safeReplacement.slice(1);
  }

  return safeReplacement;
}

function applyFrenchAccentCorrections(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  return value.replace(/\b([A-Za-z]+)\b/g, (word) => {
    const replacement = FRENCH_ACCENT_WORD_MAP.get(word.toLowerCase());
    if (!replacement) {
      return word;
    }
    return applyWordCase(word, replacement);
  });
}

function normalizeCaptionOrthography(value, language) {
  const normalized = sanitizeCaption(value);
  if (!normalized) {
    return '';
  }

  if (!String(language ?? '').toLowerCase().startsWith('fr')) {
    return normalized;
  }

  return applyFrenchAccentCorrections(normalized);
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
        'Quand ton cerveau ouvre 37 onglets en même temps',
        'POV: confiante en public, chaos à la maison'
      ];
}

function normalizeLooseText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeStringList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = [];
  for (const entry of value) {
    let cleaned = normalizeLooseText(entry, maxLength);
    if (!cleaned && isRecord(entry)) {
      cleaned = normalizeLooseText(
        entry.name ??
          entry.label ??
          entry.species ??
          entry.type ??
          entry.description ??
          entry.text ??
          '',
        maxLength
      );
    }
    if (!cleaned || normalized.includes(cleaned)) {
      continue;
    }
    normalized.push(cleaned);
    if (normalized.length >= maxItems) {
      break;
    }
  }

  return normalized;
}

function createEmptyMemeImageContext() {
  return {
    sceneSummary: '',
    environment: '',
    mood: '',
    people: [],
    animals: [],
    notableObjects: [],
    contextHooks: [],
    highConfidenceCelebrities: [],
    publicFigureHints: []
  };
}

function normalizeMemeImageContext(rawContext, language) {
  const fallback = createEmptyMemeImageContext();
  if (!isRecord(rawContext)) {
    return fallback;
  }

  const isEnglish = language.toLowerCase().startsWith('en');
  const genericPublicFigureHint = isEnglish ? 'a recognizable public figure' : 'une personne connue';

  const highConfidenceCelebrities = [];
  const publicFigureHints = [];
  const rawCandidates = Array.isArray(rawContext.famousPeopleCandidates) ? rawContext.famousPeopleCandidates : [];

  for (const candidate of rawCandidates) {
    let name = '';
    let description = '';
    let confidence = 0;

    if (typeof candidate === 'string') {
      name = normalizeLooseText(candidate, 80);
    } else if (isRecord(candidate)) {
      name = normalizeLooseText(
        candidate.name ?? candidate.fullName ?? candidate.person ?? candidate.celebrity ?? '',
        80
      );
      description = normalizeLooseText(
        candidate.description ?? candidate.reason ?? candidate.lookalike ?? candidate.label ?? '',
        100
      );
      const rawConfidence = Number.parseFloat(String(candidate.confidence ?? ''));
      confidence = Number.isFinite(rawConfidence)
        ? Math.min(1, Math.max(0, rawConfidence))
        : 0;
    }

    if (name && confidence >= HIGH_CONFIDENCE_CELEBRITY_THRESHOLD) {
      if (!highConfidenceCelebrities.includes(name)) {
        highConfidenceCelebrities.push(name);
      }
      continue;
    }

    const genericHint = description || (name ? genericPublicFigureHint : '');
    if (genericHint && !publicFigureHints.includes(genericHint)) {
      publicFigureHints.push(genericHint);
    }
  }

  return {
    sceneSummary: normalizeLooseText(rawContext.sceneSummary, 180),
    environment: normalizeLooseText(rawContext.environment, 160),
    mood: normalizeLooseText(rawContext.mood, 100),
    people: normalizeStringList(rawContext.people, 6, 80),
    animals: normalizeStringList(rawContext.animals, 6, 80),
    notableObjects: normalizeStringList(rawContext.notableObjects, 8, 80),
    contextHooks: normalizeStringList(rawContext.contextHooks, 8, 120),
    highConfidenceCelebrities: highConfidenceCelebrities.slice(0, 3),
    publicFigureHints: publicFigureHints.slice(0, 4)
  };
}

function buildImageContextBlock(imageContext, language) {
  const context = isRecord(imageContext) ? imageContext : createEmptyMemeImageContext();
  const isEnglish = language.toLowerCase().startsWith('en');
  const emptyValue = isEnglish ? 'none' : 'aucun';
  const joinOrEmpty = (items) => (items.length > 0 ? items.join(' | ') : emptyValue);

  if (isEnglish) {
    return [
      `Scene summary: ${context.sceneSummary || emptyValue}`,
      `Environment: ${context.environment || emptyValue}`,
      `Mood: ${context.mood || emptyValue}`,
      `People: ${joinOrEmpty(context.people)}`,
      `Animals: ${joinOrEmpty(context.animals)}`,
      `Notable objects: ${joinOrEmpty(context.notableObjects)}`,
      `Context hooks: ${joinOrEmpty(context.contextHooks)}`,
      `High-confidence public figures: ${joinOrEmpty(context.highConfidenceCelebrities)}`,
      `Public figure hints (describe, do not name): ${joinOrEmpty(context.publicFigureHints)}`
    ].join('\n');
  }

  return [
    `Resume scene: ${context.sceneSummary || emptyValue}`,
    `Environnement: ${context.environment || emptyValue}`,
    `Ambiance: ${context.mood || emptyValue}`,
    `Personnes: ${joinOrEmpty(context.people)}`,
    `Animaux: ${joinOrEmpty(context.animals)}`,
    `Objets notables: ${joinOrEmpty(context.notableObjects)}`,
    `Angles comiques: ${joinOrEmpty(context.contextHooks)}`,
    `Personnalites publiques haute confiance: ${joinOrEmpty(context.highConfidenceCelebrities)}`,
    `Indices personnalites (decrire sans nommer): ${joinOrEmpty(context.publicFigureHints)}`
  ].join('\n');
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
      const cleaned = normalizeCaptionOrthography(item.replace(/^\s*(?:\d+[.)]|[-*])\s*/, ''), language);
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
      .map((line) => normalizeCaptionOrthography(line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, ''), language))
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
      const cleaned = normalizeCaptionOrthography(fallback, language);
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

async function callAnthropicMemePass({
  image,
  requestId,
  systemPrompt,
  userText,
  maxTokens,
  model,
  temperature = 0.55,
  passLabel
}) {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('Server misconfigured: ANTHROPIC_API_KEY missing.');
  }

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
        model: model || (process.env.MEME_CAPTION_MODEL ?? '').trim() || DEFAULT_CAPTION_MODEL,
        max_tokens: maxTokens,
        temperature,
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
          : `${passLabel} failed.`;
      const error = new Error(upstreamMessage);
      error.status = response.status;
      throw error;
    }

    return extractAnthropicText(payload);
  } catch (error) {
    if (isRecord(error) && error.name === 'AbortError') {
      const timeoutError = new Error(`${passLabel} timed out.`);
      timeoutError.code = 'UPSTREAM_TIMEOUT';
      timeoutError.status = 504;
      throw timeoutError;
    }

    console.error(`[api/meme-generator][${requestId}] ${passLabel} failed`, error);
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function analyzeImageForMemeContext({ image, language, promptText, requestId }) {
  const isEnglish = language.toLowerCase().startsWith('en');
  const systemPrompt = isEnglish
    ? `You analyze one image for meme writing context.
Return STRICT JSON only:
{"sceneSummary":"","environment":"","mood":"","people":[],"animals":[],"notableObjects":[],"famousPeopleCandidates":[{"name":"","confidence":0.0,"description":""}],"contextHooks":[]}
Rules:
- Keep it factual and grounded only in visible content.
- Detect specific animal species when possible (example: capuchin monkey, macaque, husky, tabby cat).
- For primates, prefer explicit labels like "monkey" or "ape" when visually plausible.
- Prioritize recognition of Quebec/Canada public figures (politicians, actors, comedians, athletes, media) when visual evidence supports it.
- Use confidence from 0 to 1 for possible famous people and keep descriptions short.
- If uncertain, keep names empty or low confidence and rely on descriptive labels.
- No markdown, no commentary.`
    : `Tu analyses une image pour aider a ecrire des captions de meme.
Retourne STRICTEMENT du JSON:
{"sceneSummary":"","environment":"","mood":"","people":[],"animals":[],"notableObjects":[],"famousPeopleCandidates":[{"name":"","confidence":0.0,"description":""}],"contextHooks":[]}
Regles:
- Reste factuel, base sur ce qui est visible.
- Detecte l'espece animale precise si possible (ex: singe capucin, macaque, husky, chat tigré).
- Pour les primates, priorise des labels explicites comme "singe" ou "grand singe" quand c'est plausible.
- Priorise la reconnaissance des personnalites du Quebec/Canada (politiciens, humoristes, acteurs, athletes, medias) si les indices visuels sont suffisants.
- Utilise une confiance de 0 a 1 pour les personnalites possibles et garde des descriptions courtes.
- Si ce n'est pas clair, mets un nom vide ou une confiance basse et reste descriptif.
- Aucun markdown, aucun texte autour.`;

  const userText = promptText
    ? isEnglish
      ? `User context: ${promptText}\nAnalyze this image for meme context.`
      : `Contexte utilisateur: ${promptText}\nAnalyse cette image pour le contexte meme.`
    : isEnglish
      ? 'Analyze this image for meme context.'
      : 'Analyse cette image pour le contexte meme.';

  try {
    const rawText = await callAnthropicMemePass({
      image,
      requestId,
      systemPrompt,
      userText,
      maxTokens: DEFAULT_MAX_ANALYSIS_TOKENS,
      model: (process.env.MEME_ANALYSIS_MODEL ?? '').trim() || DEFAULT_ANALYSIS_MODEL,
      temperature: 0.25,
      passLabel: 'Image analysis'
    });
    const parsedContext = extractJsonFromText(rawText);
    return normalizeMemeImageContext(parsedContext, language);
  } catch (error) {
    console.warn(`[api/meme-generator][${requestId}] Image analysis unavailable, using neutral fallback.`, error);
    return createEmptyMemeImageContext();
  }
}

async function generateCaptionOptions({ image, language, promptText, imageContext, requestId }) {
  const isEnglish = language.toLowerCase().startsWith('en');
  const systemPrompt = isEnglish
    ? `You are Cathy Gauthier writing meme captions.
Return STRICT JSON only, no prose:
{"captions":["caption 1","caption 2","caption 3"]}
Rules:
- Exactly 3 captions
- Max 80 characters each
- Short, funny, sharable, grounded in the uploaded image context
- Prefer precise context from scene/environment/animals over generic jokes
- You may use celebrity names ONLY from "High-confidence public figures"
- Never invent celebrity names; for uncertain public figures, stay descriptive
- No numbering, no emojis-only answers, no markdown`
    : `Tu es Cathy Gauthier et tu crees des captions de meme.
Retourne STRICTEMENT du JSON, sans texte autour :
{"captions":["caption 1","caption 2","caption 3"]}
Regles:
- Exactement 3 captions
- Maximum 80 caracteres chacune
- Courtes, droles, partageables, ancrees dans le contexte visuel
- Priorise les details precis (scene/environnement/animaux) plutot que des blagues generiques
- Tu peux nommer une personnalite SEULEMENT si elle est dans "Personnalites publiques haute confiance"
- N'invente jamais de nom; si c'est incertain, reste descriptif
- Ecris en francais correct avec accents quand necessaire
- Aucune numerotation, aucun markdown`;

  const contextBlock = buildImageContextBlock(imageContext, language);
  const userText = promptText
    ? isEnglish
      ? `User context: ${promptText}\nImage analysis:\n${contextBlock}\nCreate 3 meme captions.`
      : `Contexte utilisateur: ${promptText}\nAnalyse image:\n${contextBlock}\nCree 3 captions de meme.`
    : isEnglish
      ? `Image analysis:\n${contextBlock}\nCreate 3 meme captions from this image.`
      : `Analyse image:\n${contextBlock}\nCree 3 captions de meme pour cette image.`;

  const rawText = await callAnthropicMemePass({
    image,
    requestId,
    systemPrompt,
    userText,
    maxTokens: DEFAULT_MAX_CAPTION_TOKENS,
    passLabel: 'Caption generation'
  });

  const parsed = parseCaptionCandidates(rawText, language);
  if (parsed.length < 3) {
    throw new Error('Caption generation returned insufficient options.');
  }

  return parsed;
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
  const normalizedCaption = normalizeCaptionOrthography(body.caption, language);
  if (!normalizedCaption) {
    throw new Error('caption is required for finalize.');
  }

  return {
    language,
    image,
    caption: normalizedCaption,
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
      const imageContext = await analyzeImageForMemeContext({
        image: payload.image,
        language: payload.language,
        promptText: payload.promptText,
        requestId
      });
      const captions = await generateCaptionOptions({
        image: payload.image,
        language: payload.language,
        promptText: payload.promptText,
        imageContext,
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
