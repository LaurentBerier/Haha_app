import * as AppleAuthentication from 'expo-apple-authentication';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import type { AuthSession, AuthUser } from '../models/AuthUser';
import { assertSupabaseConfigured, supabase } from './supabaseClient';

export type AuthStateChangeCallback = (event: AuthChangeEvent, session: AuthSession) => void;

function toAuthUser(sessionUser: Session['user']): AuthUser {
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
      emailRedirectTo: 'hahaha://'
    }
  });
  if (error) {
    throw error;
  }
  return toAuthSession(data.session);
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
