export type OtpType = 'signup' | 'email' | 'recovery' | 'invite' | 'magiclink' | 'email_change';

export const AUTH_PAYLOAD_KEYS = [
  'code',
  'token_hash',
  'type',
  'flow',
  'access_token',
  'refresh_token',
  'error',
  'error_description'
] as const;
const NESTED_CALLBACK_URL_KEYS = ['url', 'redirect_to', 'redirect_url', 'link'] as const;

type RouteParamValue = string | string[] | undefined;

export interface AuthCallbackRouteParams {
  code?: RouteParamValue;
  token_hash?: RouteParamValue;
  type?: RouteParamValue;
  flow?: RouteParamValue;
  access_token?: RouteParamValue;
  refresh_token?: RouteParamValue;
  error?: RouteParamValue;
  error_description?: RouteParamValue;
}

export interface ParsedAuthCallbackParams {
  code: string | null;
  tokenHash: string | null;
  type: OtpType | null;
  flow: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  callbackError: string | null;
  isRecovery: boolean;
}

function decodeUriComponentSafely(value: string): string {
  let decoded = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function tryParseUrl(value: string | null): URL | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

export function isAuthCallbackUrl(url: URL): boolean {
  if (url.protocol === 'hahaha:' && url.hostname === 'auth' && url.pathname === '/callback') {
    return true;
  }

  const normalizedPath = url.pathname.toLowerCase();
  return normalizedPath.endsWith('/auth/callback');
}

interface ParseAuthCallbackParamsInput {
  query: URLSearchParams;
  hash: URLSearchParams;
  params: AuthCallbackRouteParams;
}

interface AuthErrorLike {
  message?: string | null;
}

interface AuthResponseLike {
  error?: AuthErrorLike | null;
}

interface SupabaseAuthLike {
  setSession(payload: { access_token: string; refresh_token: string }): Promise<AuthResponseLike>;
  exchangeCodeForSession(code: string): Promise<AuthResponseLike>;
  verifyOtp(payload: { token_hash: string; type: OtpType }): Promise<AuthResponseLike>;
}

function getParamValue(value: RouteParamValue): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string' && first.trim()) {
      return first.trim();
    }
  }
  return null;
}

function toOtpType(value: string | null): OtpType | null {
  if (!value) {
    return null;
  }

  switch (value) {
    case 'signup':
    case 'email':
    case 'recovery':
    case 'invite':
    case 'magiclink':
    case 'email_change':
      return value;
    default:
      return null;
  }
}

function toErrorMessage(error: AuthErrorLike | null | undefined): string | null {
  if (!error || typeof error.message !== 'string') {
    return null;
  }
  const message = error.message.trim();
  return message ? message : null;
}

export function hasAuthPayload(url: URL): boolean {
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  return AUTH_PAYLOAD_KEYS.some((key) => Boolean(url.searchParams.get(key) || hashParams.get(key)));
}

function extractNestedCallbackCandidates(url: URL): string[] {
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  const candidates: string[] = [];

  for (const key of NESTED_CALLBACK_URL_KEYS) {
    const rawValue = url.searchParams.get(key) ?? hashParams.get(key);
    if (!rawValue) {
      continue;
    }
    candidates.push(rawValue, decodeUriComponentSafely(rawValue));
  }

  return candidates;
}

export function resolveAuthCallbackUrl(rawUrl: string | null): URL | null {
  if (!rawUrl || !rawUrl.trim()) {
    return null;
  }

  const queue: string[] = [rawUrl];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!candidate || visited.has(candidate)) {
      continue;
    }
    visited.add(candidate);

    const parsed = tryParseUrl(candidate);
    if (!parsed) {
      continue;
    }

    const hasPayload = hasAuthPayload(parsed);
    const nestedCandidates = extractNestedCallbackCandidates(parsed);
    if (hasPayload) {
      return parsed;
    }
    for (const nestedCandidate of nestedCandidates) {
      if (!visited.has(nestedCandidate)) {
        queue.push(nestedCandidate);
      }
    }

    if (isAuthCallbackUrl(parsed) && nestedCandidates.length === 0) {
      return parsed;
    }
  }

  return tryParseUrl(rawUrl);
}

export function buildNativeCallbackUrl(url: URL, authCallbackSchemeUrl: string): string {
  const nextSearch = new URLSearchParams(url.searchParams);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  nextSearch.set('opened_in_app', '1');
  for (const key of AUTH_PAYLOAD_KEYS) {
    if (nextSearch.get(key)) {
      continue;
    }
    const value = hashParams.get(key);
    if (value) {
      nextSearch.set(key, value);
    }
  }

  const search = nextSearch.toString();
  const hash = url.hash || '';
  return `${authCallbackSchemeUrl}${search ? `?${search}` : ''}${hash}`;
}

export function parseAuthCallbackParams({ query, hash, params }: ParseAuthCallbackParamsInput): ParsedAuthCallbackParams {
  const code = query.get('code') ?? hash.get('code') ?? getParamValue(params.code);
  const tokenHash = query.get('token_hash') ?? hash.get('token_hash') ?? getParamValue(params.token_hash);
  const type = toOtpType(query.get('type') ?? hash.get('type') ?? getParamValue(params.type));
  const flow = query.get('flow') ?? hash.get('flow') ?? getParamValue(params.flow);
  const accessToken = query.get('access_token') ?? hash.get('access_token') ?? getParamValue(params.access_token);
  const refreshToken = query.get('refresh_token') ?? hash.get('refresh_token') ?? getParamValue(params.refresh_token);
  const callbackError =
    query.get('error_description') ??
    hash.get('error_description') ??
    query.get('error') ??
    hash.get('error') ??
    getParamValue(params.error_description) ??
    getParamValue(params.error);

  const isRecovery = flow === 'recovery' || type === 'recovery';

  return {
    code,
    tokenHash,
    type,
    flow,
    accessToken,
    refreshToken,
    callbackError,
    isRecovery
  };
}

export async function resolveAuthCallbackSession(
  auth: SupabaseAuthLike,
  params: ParsedAuthCallbackParams
): Promise<string | null> {
  if (params.accessToken && params.refreshToken) {
    const { error } = await auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken
    });
    return toErrorMessage(error);
  }

  if (params.code) {
    const { error } = await auth.exchangeCodeForSession(params.code);
    if (!error) {
      return null;
    }

    if (params.tokenHash && params.type) {
      const { error: fallbackOtpError } = await auth.verifyOtp({
        token_hash: params.tokenHash,
        type: params.type
      });
      if (!fallbackOtpError) {
        return null;
      }
      return toErrorMessage(fallbackOtpError) ?? toErrorMessage(error);
    }

    return toErrorMessage(error);
  }

  if (params.tokenHash && params.type) {
    const { error } = await auth.verifyOtp({
      token_hash: params.tokenHash,
      type: params.type
    });
    return toErrorMessage(error);
  }

  return params.callbackError;
}
