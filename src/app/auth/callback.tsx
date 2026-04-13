import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { AUTH_CALLBACK_SCHEME_URL } from '../../config/constants';
import { assertSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { theme } from '../../theme';

type OtpType = 'signup' | 'email' | 'recovery' | 'invite' | 'magiclink' | 'email_change';

function getParamValue(value: string | string[] | undefined): string | null {
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

function toFriendlyError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid') || normalized.includes('expired')) {
    return "Le lien de validation est invalide ou expiré. Reviens à la connexion pour demander un nouveau lien.";
  }
  if (normalized.includes('already') && normalized.includes('confirmed')) {
    return 'Ce compte est déjà confirmé. Connecte-toi pour continuer.';
  }
  return 'La validation du compte a échoué. Reviens à la connexion pour réessayer.';
}

function getWebCurrentUrl(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return typeof window.location?.href === 'string' && window.location.href ? window.location.href : null;
}

function hasAuthPayload(url: URL): boolean {
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  const keys = ['code', 'token_hash', 'type', 'access_token', 'refresh_token', 'error', 'error_description', 'flow'] as const;
  return keys.some((key) => Boolean(url.searchParams.get(key) || hashParams.get(key)));
}

function shouldTryOpenNativeApp(url: URL): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const isMobileBrowser = /iphone|ipad|ipod|android/.test(userAgent);
  if (!isMobileBrowser) {
    return false;
  }

  if (!hasAuthPayload(url)) {
    return false;
  }

  const alreadyOpenedInApp = url.searchParams.get('opened_in_app') === '1';
  if (alreadyOpenedInApp) {
    return false;
  }

  try {
    const previous = window.sessionStorage.getItem('haha-auth-native-handoff-url');
    if (previous === url.href) {
      return false;
    }
  } catch {
    // Ignore unavailable session storage.
  }

  return true;
}

function buildNativeCallbackUrl(url: URL): string {
  const nextSearch = new URLSearchParams(url.searchParams);
  nextSearch.set('opened_in_app', '1');
  const search = nextSearch.toString();
  const hash = url.hash || '';
  return `${AUTH_CALLBACK_SCHEME_URL}${search ? `?${search}` : ''}${hash}`;
}

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    code?: string;
    token_hash?: string;
    type?: string;
    flow?: string;
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  }>();
  const [isResolving, setIsResolving] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const resolveCallback = async () => {
      setIsResolving(true);
      setErrorMessage(null);
      try {
        assertSupabaseConfigured();

        const incomingUrl = await Linking.getInitialURL();
        const callbackUrl = incomingUrl ?? getWebCurrentUrl();
        if (Platform.OS === 'web' && callbackUrl) {
          try {
            const webUrl = new URL(callbackUrl);
            if (shouldTryOpenNativeApp(webUrl)) {
              const nativeUrl = buildNativeCallbackUrl(webUrl);
              window.sessionStorage.setItem('haha-auth-native-handoff-url', webUrl.href);
              window.location.assign(nativeUrl);
            }
          } catch {
            // Keep normal callback flow as fallback.
          }
        }
        const url = callbackUrl ? new URL(callbackUrl) : null;
        const hash = new URLSearchParams(url?.hash.replace(/^#/, ''));
        const query = url?.searchParams ?? new URLSearchParams();

        const code = query.get('code') ?? getParamValue(params.code);
        const tokenHash = query.get('token_hash') ?? hash.get('token_hash') ?? getParamValue(params.token_hash);
        const type = (query.get('type') ?? hash.get('type') ?? getParamValue(params.type)) as OtpType | null;
        const flow = query.get('flow') ?? getParamValue(params.flow);
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
        let authErrorMessage: string | null = null;

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
          if (error) {
            authErrorMessage = error.message;
          }
        } else if (code && callbackUrl) {
          const { error } = await supabase.auth.exchangeCodeForSession(callbackUrl);
          if (error) {
            authErrorMessage = error.message;
          }
        } else if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type
          });
          if (error) {
            authErrorMessage = error.message;
          }
        } else if (callbackError) {
          authErrorMessage = callbackError;
        }

        if (authErrorMessage && __DEV__) {
          console.warn('[AuthCallback] auth callback failed:', authErrorMessage);
        }

        const {
          data: { session }
        } = await supabase.auth.getSession();

        if (!isMounted) {
          return;
        }

        if (session) {
          router.replace(isRecovery ? '/(auth)/reset-password' : '/');
          return;
        }

        if (authErrorMessage) {
          setErrorMessage(toFriendlyError(authErrorMessage));
          return;
        }

        setErrorMessage(toFriendlyError('invalid or expired'));
      } catch (error) {
        if (__DEV__) {
          console.warn('[AuthCallback] Callback handling failed:', error);
        }
        if (isMounted) {
          setErrorMessage('Une erreur technique est survenue. Reviens à la connexion pour demander un nouveau lien.');
        }
      } finally {
        if (isMounted) {
          setIsResolving(false);
        }
      }
    };

    void resolveCallback();

    return () => {
      isMounted = false;
    };
  }, [params.access_token, params.code, params.flow, params.refresh_token, params.token_hash, params.type]);

  return (
    <View style={styles.screen} testID="auth-callback-screen">
      {isResolving ? (
        <>
          <Text style={styles.title}>Validation du compte en cours...</Text>
          <Text style={styles.subtitle}>Redirection en cours...</Text>
        </>
      ) : errorMessage ? (
        <>
          <Text style={styles.title}>Impossible de valider ce lien</Text>
          <Text style={styles.subtitle}>{errorMessage}</Text>
          <Pressable style={styles.primaryButton} onPress={() => router.replace('/(auth)/login')} testID="callback-go-login">
            <Text style={styles.primaryButtonLabel}>Retour à la connexion</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.md
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center'
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 420
  },
  primaryButton: {
    marginTop: theme.spacing.sm,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg
  },
  primaryButtonLabel: {
    color: theme.colors.textPrimary,
    fontWeight: '700',
    fontSize: 15
  }
});
