import * as AppleAuthentication from 'expo-apple-authentication';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { CLAUDE_PROXY_URL } from '../config/env';
import type { AccountTypeId } from '../config/accountTypes';
import type { AuthSession, AuthUser } from '../models/AuthUser';
import { assertSupabaseConfigured, supabase } from './supabaseClient';

export type AuthStateChangeCallback = (event: AuthChangeEvent, session: AuthSession) => void;

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
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
  return toAuthSession(data.session);
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthSession> {
  assertSupabaseConfigured();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: 'hahaha://auth/callback'
    }
  });
  if (error) {
    throw error;
  }
  return toAuthSession(data.session);
}

export async function requestPasswordReset(email: string): Promise<void> {
  assertSupabaseConfigured();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: 'hahaha://auth/callback?flow=recovery'
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
  return CLAUDE_PROXY_URL.trim().replace(/\/claude\/?$/, '');
}

export async function deleteAccount(accessToken: string): Promise<void> {
  const baseUrl = toBackendBaseUrl();
  if (!baseUrl) {
    throw new Error('Missing Claude proxy URL. Set EXPO_PUBLIC_CLAUDE_PROXY_URL.');
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

export async function refreshSession(): Promise<AuthSession> {
  assertSupabaseConfigured();
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    throw error;
  }
  return toAuthSession(data.session);
}

export async function getStoredSession(): Promise<AuthSession> {
  assertSupabaseConfigured();
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return toAuthSession(data.session);
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
