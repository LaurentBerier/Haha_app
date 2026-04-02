import * as AppleAuthentication from 'expo-apple-authentication';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { API_BASE_URL, CLAUDE_PROXY_URL } from '../config/env';
import type { AccountTypeId } from '../config/accountTypes';
import { AUTH_CALLBACK_SCHEME_URL } from '../config/constants';
import type { AuthSession, AuthUser } from '../models/AuthUser';
import { assertSupabaseConfigured, supabase } from './supabaseClient';

export type AuthStateChangeCallback = (event: AuthChangeEvent, session: AuthSession) => void;
export interface SignUpResult {
  session: AuthSession;
  confirmationRequired: boolean;
}
export interface UsageSummary {
  messagesUsed: number;
  messagesCap: number | null;
  resetDate: string;
  softCapReached?: boolean;
  economyMode?: boolean;
}

const SESSION_REFRESH_LEEWAY_SECONDS = 30;

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('network request failed') || message.includes('failed to fetch');
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message.toLowerCase();
  }

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return ((error as { message: string }).message ?? '').toLowerCase();
  }

  return '';
}

function isInvalidRefreshTokenError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  if (!message) {
    return false;
  }

  return (
    message.includes('invalid refresh token') ||
    message.includes('refresh token not found') ||
    message.includes('refresh_token_not_found')
  );
}

async function clearPersistedSupabaseSession(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'local' });
    return;
  } catch {
    // Fall through to generic sign-out fallback.
  }

  try {
    await supabase.auth.signOut();
  } catch {
    // Best effort: stale local auth state might already be gone.
  }
}

async function recoverFromInvalidRefreshToken(error: unknown): Promise<boolean> {
  if (!isInvalidRefreshTokenError(error)) {
    return false;
  }

  await clearPersistedSupabaseSession();
  return true;
}

function isSessionExpiringSoon(session: Session): boolean {
  const expiresAt = session.expires_at;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return expiresAt <= nowSeconds + SESSION_REFRESH_LEEWAY_SECONDS;
}

async function withNetworkRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isNetworkFailure(error)) {
      throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
    return operation();
  }
}

function getAuthCallbackUrl(flow?: 'recovery'): string {
  if (Platform.OS !== 'web') {
    return flow ? `${AUTH_CALLBACK_SCHEME_URL}?flow=${flow}` : AUTH_CALLBACK_SCHEME_URL;
  }

  if (
    typeof window !== 'undefined' &&
    typeof window.location?.origin === 'string' &&
    /^https?:\/\//i.test(window.location.origin)
  ) {
    const normalizedOrigin = window.location.origin.replace(/\/+$/, '');
    const base = `${normalizedOrigin}/auth/callback`;
    return flow ? `${base}?flow=${flow}` : base;
  }

  return flow ? `${AUTH_CALLBACK_SCHEME_URL}?flow=${flow}` : AUTH_CALLBACK_SCHEME_URL;
}

function toAuthUser(sessionUser: Session['user']): AuthUser {
  const role = typeof sessionUser.app_metadata?.role === 'string' ? sessionUser.app_metadata.role : null;
  const accountType =
    typeof sessionUser.app_metadata?.account_type === 'string'
      ? (sessionUser.app_metadata.account_type as AccountTypeId)
      : typeof sessionUser.user_metadata?.account_type === 'string'
        ? (sessionUser.user_metadata.account_type as AccountTypeId)
        : null;

  return {
    id: sessionUser.id,
    email: sessionUser.email ?? '',
    displayName:
      typeof sessionUser.user_metadata?.display_name === 'string'
        ? sessionUser.user_metadata.display_name
        : typeof sessionUser.user_metadata?.full_name === 'string'
          ? sessionUser.user_metadata.full_name
          : null,
    avatarUrl: typeof sessionUser.user_metadata?.avatar_url === 'string' ? sessionUser.user_metadata.avatar_url : null,
    role,
    accountType,
    createdAt: sessionUser.created_at
  };
}

function toAuthSession(session: Session | null): AuthSession {
  if (!session) {
    return null;
  }

  return {
    user: toAuthUser(session.user),
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? 0
  };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthSession> {
  assertSupabaseConfigured();
  const { data, error } = await withNetworkRetry(() => supabase.auth.signInWithPassword({ email, password }));
  if (error) {
    throw error;
  }
  return toAuthSession(data.session);
}

export async function signUpWithEmail(email: string, password: string): Promise<SignUpResult> {
  assertSupabaseConfigured();
  const { data, error } = await withNetworkRetry(() =>
    supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getAuthCallbackUrl()
    }
    })
  );
  if (error) {
    throw error;
  }
  const session = toAuthSession(data.session);
  return {
    session,
    confirmationRequired: !session
  };
}

export async function requestPasswordReset(email: string): Promise<void> {
  assertSupabaseConfigured();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: getAuthCallbackUrl('recovery')
  });

  if (error) {
    throw error;
  }
}

export async function updatePassword(password: string): Promise<void> {
  assertSupabaseConfigured();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    throw error;
  }
}

function normalizeDisplayName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 40);
}

export async function updatePreferredDisplayName(displayName: string | null): Promise<AuthSession> {
  assertSupabaseConfigured();

  const normalizedDisplayName = normalizeDisplayName(displayName);
  const { error } = await supabase.auth.updateUser({
    data: {
      display_name: normalizedDisplayName
    }
  });
  if (error) {
    throw error;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw sessionError;
  }

  return toAuthSession(sessionData.session);
}

export async function signInWithApple(): Promise<AuthSession> {
  assertSupabaseConfigured();
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL]
  });

  if (!credential.identityToken) {
    throw new Error("Apple Sign-In n'a pas retourné de token d'identité.");
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken
  });

  if (error) {
    throw error;
  }

  return toAuthSession(data.session);
}

export async function signOut(): Promise<void> {
  assertSupabaseConfigured();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

function toBackendBaseUrl(): string {
  const explicitBase = API_BASE_URL.trim().replace(/\/+$/, '');
  if (explicitBase) {
    return explicitBase;
  }

  const proxyUrl = CLAUDE_PROXY_URL.trim();
  if (!proxyUrl) {
    return '';
  }

  if (proxyUrl.startsWith('/')) {
    return proxyUrl.replace(/\/claude\/?$/, '');
  }

  try {
    const parsed = new URL(proxyUrl);
    const normalizedPathname = parsed.pathname.replace(/\/+$/, '');
    const basePath = normalizedPathname.replace(/\/claude\/?$/, '');
    return `${parsed.protocol}//${parsed.host}${basePath}`;
  } catch {
    return '';
  }
}

export async function deleteAccount(accessToken: string): Promise<void> {
  const baseUrl = toBackendBaseUrl();
  if (!baseUrl) {
    throw new Error('Missing backend API base URL. Set EXPO_PUBLIC_API_BASE_URL or EXPO_PUBLIC_CLAUDE_PROXY_URL.');
  }

  const response = await fetch(`${baseUrl}/delete-account`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    let message = 'Impossible de supprimer le compte.';
    try {
      const payload = await response.json();
      if (
        payload &&
        typeof payload === 'object' &&
        'error' in payload &&
        payload.error &&
        typeof payload.error === 'object' &&
        'message' in payload.error &&
        typeof payload.error.message === 'string'
      ) {
        message = payload.error.message;
      }
    } catch {
      // Keep default message.
    }

    throw new Error(message);
  }
}

function toNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export async function getUsageSummary(accessToken: string): Promise<UsageSummary> {
  const baseUrl = toBackendBaseUrl();
  if (!baseUrl) {
    throw new Error('Missing backend API base URL. Set EXPO_PUBLIC_API_BASE_URL or EXPO_PUBLIC_CLAUDE_PROXY_URL.');
  }

  const response = await fetch(`${baseUrl}/usage-summary`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    let message = 'Impossible de récupérer le quota mensuel.';
    try {
      const payload = await response.json();
      if (
        payload &&
        typeof payload === 'object' &&
        'error' in payload &&
        payload.error &&
        typeof payload.error === 'object' &&
        'message' in payload.error &&
        typeof payload.error.message === 'string'
      ) {
        message = payload.error.message;
      }
    } catch {
      // Keep default message.
    }
    throw new Error(message);
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid usage summary payload.');
  }

  const asRecord = payload as {
    messagesUsed?: unknown;
    messagesCap?: unknown;
    resetDate?: unknown;
    softCapReached?: unknown;
    economyMode?: unknown;
  };
  const summary: UsageSummary = {
    messagesUsed: toNonNegativeInteger(asRecord.messagesUsed),
    messagesCap: typeof asRecord.messagesCap === 'number' && Number.isFinite(asRecord.messagesCap) ? asRecord.messagesCap : null,
    resetDate: typeof asRecord.resetDate === 'string' ? asRecord.resetDate : ''
  };

  if (typeof asRecord.softCapReached === 'boolean') {
    summary.softCapReached = asRecord.softCapReached;
  }
  if (typeof asRecord.economyMode === 'boolean') {
    summary.economyMode = asRecord.economyMode;
  }

  return summary;
}

export async function refreshSession(): Promise<AuthSession> {
  assertSupabaseConfigured();
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    if (await recoverFromInvalidRefreshToken(error)) {
      return null;
    }
    throw error;
  }
  return toAuthSession(data.session);
}

export async function getStoredSession(): Promise<AuthSession> {
  assertSupabaseConfigured();
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    if (await recoverFromInvalidRefreshToken(error)) {
      return null;
    }
    throw error;
  }

  const session = data.session;
  if (!session) {
    return null;
  }

  const hasAccessToken = typeof session.access_token === 'string' && session.access_token.trim().length > 0;
  const hasRefreshToken = typeof session.refresh_token === 'string' && session.refresh_token.trim().length > 0;
  if (!hasAccessToken || !hasRefreshToken) {
    await clearPersistedSupabaseSession();
    return null;
  }

  if (!isSessionExpiringSoon(session)) {
    return toAuthSession(session);
  }

  const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession({
    refresh_token: session.refresh_token
  });
  if (refreshError) {
    if (await recoverFromInvalidRefreshToken(refreshError)) {
      return null;
    }
    throw refreshError;
  }

  return toAuthSession(refreshedData.session);
}

export function onAuthStateChange(callback: AuthStateChangeCallback): () => void {
  assertSupabaseConfigured();
  const {
    data: { subscription }
  } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, toAuthSession(session));
  });

  return () => {
    subscription.unsubscribe();
  };
}
