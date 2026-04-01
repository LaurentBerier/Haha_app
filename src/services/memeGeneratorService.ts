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
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function buildEndpointCandidates(): string[] {
  const isWebRuntime = typeof window !== 'undefined';
  const candidates: string[] = [];

  const addCandidate = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized) {
      return;
    }
    if (!isWebRuntime && normalized.startsWith('/')) {
      return;
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  if (isWebRuntime && typeof window.location?.origin === 'string' && window.location.origin) {
    const origin = normalizeUrl(window.location.origin);
    if (origin) {
      addCandidate(`${origin}/api/meme-generator`);
    }
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

function toError(payload: unknown, status: number): ApiError {
  const error = new Error('Meme generation failed.') as ApiError;
  error.status = status;

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
  }

  return error;
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

async function callMemeApi<T>(accessToken: string, body: Record<string, unknown>, parser: (payload: unknown) => T): Promise<T> {
  const token = accessToken.trim();
  if (!token) {
    const error = new Error('Unauthorized.') as ApiError;
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  const endpointCandidates = buildEndpointCandidates();
  if (endpointCandidates.length === 0) {
    throw new Error('Missing meme API endpoint.');
  }

  let lastError: ApiError | null = null;

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

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = toError(payload, response.status);
        continue;
      }

      return parser(payload);
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error('Meme API request failed.');
      lastError = normalized as ApiError;
    }
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
