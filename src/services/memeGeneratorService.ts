import { API_BASE_URL, CLAUDE_PROXY_URL } from '../config/env';
import type { ChatImageAttachment } from '../models/ChatSendPayload';

export type MemePlacement = 'top' | 'bottom';
export type MemeLogoPlacement = 'left' | 'right';

export interface MemeOption {
  optionId: string;
  caption: string;
  placement: MemePlacement;
  logoPlacement: MemeLogoPlacement;
  previewImageBase64: string;
  mimeType: string;
}

export interface MemeProposeResult {
  draftId: string;
  options: MemeOption[];
}

export interface MemeFinalizeResult {
  imageBase64: string;
  mimeType: string;
  caption: string;
  placement: MemePlacement;
  logoPlacement: MemeLogoPlacement;
}

interface ProposePayload {
  language: string;
  image: ChatImageAttachment;
  text?: string;
  accessToken: string;
}

interface FinalizePayload {
  language: string;
  image: ChatImageAttachment;
  caption: string;
  placement: MemePlacement;
  accessToken: string;
}

interface ApiError extends Error {
  code?: string;
  status?: number;
  requestId?: string;
}

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 180;

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function getWebOrigin(): string | null {
  if (typeof window === 'undefined' || typeof window.location?.origin !== 'string') {
    return null;
  }

  const origin = normalizeUrl(window.location.origin);
  return origin || null;
}

function canonicalizeEndpoint(candidate: string, webOrigin: string | null): string {
  const normalized = candidate.trim();
  if (!normalized) {
    return '';
  }

  if (webOrigin) {
    try {
      const absolute = normalized.startsWith('/') ? new URL(normalized, webOrigin) : new URL(normalized);
      return normalizeUrl(absolute.toString());
    } catch {
      return normalized;
    }
  }

  return normalized;
}

function buildEndpointCandidates(): string[] {
  const isWebRuntime = typeof window !== 'undefined';
  const webOrigin = getWebOrigin();
  const candidates: string[] = [];

  const addCandidate = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized) {
      return;
    }
    if (!isWebRuntime && normalized.startsWith('/')) {
      return;
    }

    const canonical = canonicalizeEndpoint(normalized, webOrigin);
    if (!canonical) {
      return;
    }

    if (!candidates.includes(canonical)) {
      candidates.push(canonical);
    }
  };

  if (isWebRuntime && webOrigin) {
    addCandidate(`${webOrigin}/api/meme-generator`);
    addCandidate('/api/meme-generator');
  }

  const apiBase = normalizeUrl(API_BASE_URL);
  if (apiBase) {
    addCandidate(`${apiBase}/meme-generator`);
  }

  const claudeProxy = normalizeUrl(CLAUDE_PROXY_URL);
  if (claudeProxy) {
    addCandidate(claudeProxy.replace(/\/claude$/, '/meme-generator'));
  }

  return candidates;
}

function resolveHeaderValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object' || typeof (headers as { get?: unknown }).get !== 'function') {
    return null;
  }

  const value = (headers as { get: (key: string) => string | null }).get(name);
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function parseResponseRequestId(payload: unknown, headers: unknown): string | null {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    payload.error &&
    typeof payload.error === 'object' &&
    'requestId' in payload.error &&
    typeof (payload.error as { requestId?: unknown }).requestId === 'string'
  ) {
    const candidate = ((payload.error as { requestId: string }).requestId ?? '').trim();
    if (candidate) {
      return candidate;
    }
  }

  return resolveHeaderValue(headers, 'x-request-id') ?? resolveHeaderValue(headers, 'X-Request-Id');
}

async function parseResponsePayload(response: { text: () => Promise<string> }): Promise<unknown> {
  const rawText = await response.text().catch(() => '');
  if (!rawText.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}

function toError(payload: unknown, status: number, requestId: string | null): ApiError {
  const error = new Error('Meme generation failed.') as ApiError;
  error.status = status;
  if (requestId) {
    error.requestId = requestId;
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    payload.error &&
    typeof payload.error === 'object'
  ) {
    const source = payload.error as Record<string, unknown>;
    if (typeof source.message === 'string' && source.message.trim()) {
      error.message = source.message.trim();
    }
    if (typeof source.code === 'string' && source.code.trim()) {
      error.code = source.code.trim();
    }

    return error;
  }

  if (typeof payload === 'string') {
    const normalizedPayload = payload.trim();
    if (normalizedPayload && !normalizedPayload.startsWith('<!DOCTYPE') && !normalizedPayload.startsWith('<html')) {
      error.message = normalizedPayload.slice(0, 180);
    }
  }

  return error;
}

function isNetworkFailure(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('load failed') ||
    message.includes('timeout')
  );
}

function isTransientApiError(error: ApiError): boolean {
  if (typeof error.status === 'number' && [500, 502, 503, 504].includes(error.status)) {
    return true;
  }

  const normalizedCode = typeof error.code === 'string' ? error.code.trim().toUpperCase() : '';
  if (normalizedCode === 'UPSTREAM_TIMEOUT' || normalizedCode === 'RENDERER_UNAVAILABLE') {
    return true;
  }

  return isNetworkFailure(error);
}

function normalizeMemePlacement(value: unknown): MemePlacement {
  return value === 'bottom' ? 'bottom' : 'top';
}

function normalizeLogoPlacement(value: unknown): MemeLogoPlacement {
  return value === 'left' ? 'left' : 'right';
}

function assertBase64(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing ${label} in meme response.`);
  }

  return value.trim();
}

function normalizeProposeResponse(payload: unknown): MemeProposeResult {
  const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const draftId = typeof source.draftId === 'string' && source.draftId.trim() ? source.draftId.trim() : '';
  if (!draftId) {
    throw new Error('Invalid meme response: missing draftId.');
  }

  const rawOptions = Array.isArray(source.options) ? source.options : [];
  const options = rawOptions
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const option = entry as Record<string, unknown>;
      const optionId = typeof option.optionId === 'string' ? option.optionId.trim() : '';
      const caption = typeof option.caption === 'string' ? option.caption.trim() : '';
      const previewImageBase64 = assertBase64(option.previewImageBase64, 'previewImageBase64');
      const mimeTypeCandidate =
        typeof option.mimeType === 'string'
          ? option.mimeType.trim()
          : typeof option.previewMimeType === 'string'
            ? option.previewMimeType.trim()
            : '';
      const mimeType = mimeTypeCandidate || 'image/png';

      return {
        optionId,
        caption,
        placement: normalizeMemePlacement(option.placement),
        logoPlacement: normalizeLogoPlacement(option.logoPlacement),
        previewImageBase64,
        mimeType
      };
    })
    .filter((entry) => entry.optionId.length > 0 && entry.caption.length > 0)
    .slice(0, 3);

  if (options.length !== 3) {
    throw new Error('Invalid meme response: expected exactly 3 options.');
  }

  return {
    draftId,
    options
  };
}

function normalizeFinalizeResponse(payload: unknown): MemeFinalizeResult {
  const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const imageBase64 = assertBase64(source.imageBase64, 'imageBase64');
  const mimeType = typeof source.mimeType === 'string' && source.mimeType.trim() ? source.mimeType.trim() : 'image/png';
  const caption = typeof source.caption === 'string' ? source.caption.trim() : '';
  if (!caption) {
    throw new Error('Invalid meme response: caption is missing.');
  }

  return {
    imageBase64,
    mimeType,
    caption,
    placement: normalizeMemePlacement(source.placement),
    logoPlacement: normalizeLogoPlacement(source.logoPlacement)
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function toApiError(error: unknown): ApiError {
  const normalized = (error instanceof Error ? error : new Error('Meme API request failed.')) as ApiError;
  if (!normalized.code && isNetworkFailure(normalized)) {
    normalized.code = 'NETWORK_ERROR';
  }
  return normalized;
}

async function callMemeApi<T>(accessToken: string, body: Record<string, unknown>, parser: (payload: unknown) => T): Promise<T> {
  const token = accessToken.trim();
  if (!token) {
    const error = new Error('Unauthorized.') as ApiError;
    error.code = 'UNAUTHORIZED';
    error.status = 401;
    throw error;
  }

  const endpointCandidates = buildEndpointCandidates();
  if (endpointCandidates.length === 0) {
    throw new Error('Missing meme API endpoint.');
  }

  let lastError: ApiError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let sawTransientError = false;

    for (const endpoint of endpointCandidates) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        const payload = await parseResponsePayload(response);
        const requestId = parseResponseRequestId(payload, response.headers);

        if (!response.ok) {
          const endpointError = toError(payload, response.status, requestId);
          lastError = endpointError;
          if (isTransientApiError(endpointError)) {
            sawTransientError = true;
          }
          continue;
        }

        try {
          return parser(payload);
        } catch (error: unknown) {
          const parseError = toApiError(error);
          parseError.code = parseError.code ?? 'INVALID_RESPONSE';
          parseError.status = typeof parseError.status === 'number' ? parseError.status : response.status;
          if (requestId) {
            parseError.requestId = requestId;
          }
          throw parseError;
        }
      } catch (error: unknown) {
        const normalized = toApiError(error);
        lastError = normalized;
        if (isTransientApiError(normalized)) {
          sawTransientError = true;
          continue;
        }
      }
    }

    if (lastError && !isTransientApiError(lastError)) {
      throw lastError;
    }

    if (!sawTransientError || attempt >= MAX_ATTEMPTS - 1) {
      break;
    }

    await sleep(RETRY_DELAY_MS);
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error('Meme API request failed.');
}

export async function proposeMemeOptions(params: ProposePayload): Promise<MemeProposeResult> {
  return callMemeApi(
    params.accessToken,
    {
      action: 'propose',
      language: params.language,
      text: params.text,
      image: {
        mediaType: params.image.mediaType,
        base64: params.image.base64
      }
    },
    normalizeProposeResponse
  );
}

export async function finalizeMemeImage(params: FinalizePayload): Promise<MemeFinalizeResult> {
  return callMemeApi(
    params.accessToken,
    {
      action: 'finalize',
      language: params.language,
      caption: params.caption,
      placement: params.placement,
      image: {
        mediaType: params.image.mediaType,
        base64: params.image.base64
      }
    },
    normalizeFinalizeResponse
  );
}
