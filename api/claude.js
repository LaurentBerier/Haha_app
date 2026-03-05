const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const { createClient } = require('@supabase/supabase-js');
const { attachRequestId, extractBearerToken, getMissingEnv, sendError, setCorsHeaders } = require('./_utils');
const DEFAULT_MAX_TOKENS = 300;
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 10000;
const MAX_SYSTEM_PROMPT_CHARS = 12000;
const MAX_IMAGE_BYTES = 3_000_000;
const ALLOWED_IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

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

function parsePayload(body) {
  if (!isRecord(body)) {
    throw new Error('JSON body is required.');
  }

  const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
  if (!systemPrompt) {
    throw new Error('`systemPrompt` is required.');
  }
  if (systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
    throw new Error(`systemPrompt exceeds ${MAX_SYSTEM_PROMPT_CHARS} chars.`);
  }

  const messages = normalizeMessages(body.messages);
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
  const stream = body.stream === true;
  const temperature =
    typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? body.temperature : 0.9;
  const maxTokens =
    typeof body.maxTokens === 'number' &&
    Number.isInteger(body.maxTokens) &&
    body.maxTokens > 0 &&
    body.maxTokens <= 4096
      ? body.maxTokens
      : DEFAULT_MAX_TOKENS;

  return {
    model,
    system: systemPrompt,
    messages,
    stream,
    temperature,
    max_tokens: maxTokens
  };
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

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin =
  typeof supabaseUrl === 'string' &&
  supabaseUrl &&
  typeof serviceRoleKey === 'string' &&
  serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey)
    : null;

async function validateAuthHeader(req, requestId) {
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

  const auth = await validateAuthHeader(req, requestId);
  if (auth.error) {
    sendError(res, 401, 'Unauthorized.', { code: 'UNAUTHORIZED', requestId });
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

  let payload;
  try {
    payload = parsePayload(req.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request payload.';
    sendError(res, 400, message, { code: 'INVALID_REQUEST', requestId });
    return;
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error(`[api/claude][${requestId}] Failed to reach Anthropic`, error);
    sendError(res, 502, 'Failed to reach Anthropic API.', { code: 'UPSTREAM_UNREACHABLE', requestId });
    return;
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
