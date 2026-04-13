import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { AUTH_CALLBACK_SCHEME_URL } from '../../config/constants';
import { assertSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { theme } from '../../theme';
import {
  buildNativeCallbackUrl,
  hasAuthPayload,
  parseAuthCallbackParams,
  resolveAuthCallbackSession,
  resolveAuthCallbackUrl
} from './callbackLogic';

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

function toSafeDebugError(error: unknown): { name: string; message: string } | { message: string } {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Unknown error'
    };
  }
  if (typeof error === 'string' && error.trim()) {
    return { message: error.trim() };
  }
  return { message: 'Unknown error' };
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
  const lastHandledUrlRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const resolveCallback = async (incomingUrlOverride: string | null = null) => {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      setIsResolving(true);
      setErrorMessage(null);
      try {
        assertSupabaseConfigured();

        const fallbackWebUrl = Platform.OS === 'web' ? getWebCurrentUrl() : null;
        const initialUrl = incomingUrlOverride ?? (await Linking.getInitialURL()) ?? fallbackWebUrl;
        const resolvedUrl = resolveAuthCallbackUrl(initialUrl);
        const callbackUrl = resolvedUrl?.toString() ?? null;

        if (callbackUrl && lastHandledUrlRef.current === callbackUrl) {
          return;
        }
        if (callbackUrl) {
          lastHandledUrlRef.current = callbackUrl;
        }

        if (Platform.OS === 'web' && callbackUrl) {
          try {
            const webUrl = new URL(callbackUrl);
            if (shouldTryOpenNativeApp(webUrl)) {
              const nativeUrl = buildNativeCallbackUrl(webUrl, AUTH_CALLBACK_SCHEME_URL);
              window.sessionStorage.setItem('haha-auth-native-handoff-url', webUrl.href);
              window.location.assign(nativeUrl);
              return;
            }
          } catch {
            // Keep normal callback flow as fallback.
          }
        }

        const url = callbackUrl ? new URL(callbackUrl) : null;
        const hash = new URLSearchParams(url?.hash.replace(/^#/, ''));
        const query = url?.searchParams ?? new URLSearchParams();
        const callbackParams = parseAuthCallbackParams({ query, hash, params });
        const authErrorMessage = await resolveAuthCallbackSession(supabase.auth, callbackParams);

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
          router.replace(callbackParams.isRecovery ? '/(auth)/reset-password' : '/');
          return;
        }

        if (authErrorMessage) {
          setErrorMessage(toFriendlyError(authErrorMessage));
          return;
        }

        setErrorMessage(toFriendlyError('invalid or expired'));
      } catch (error) {
        if (__DEV__) {
          console.warn('[AuthCallback] Callback handling failed:', toSafeDebugError(error));
        }
        if (isMounted) {
          setErrorMessage('Une erreur technique est survenue. Reviens à la connexion pour demander un nouveau lien.');
        }
      } finally {
        inFlightRef.current = false;
        if (isMounted) {
          setIsResolving(false);
        }
      }
    };

    void resolveCallback();
    const urlSubscription = Linking.addEventListener('url', ({ url }) => {
      if (!isMounted) {
        return;
      }
      void resolveCallback(url ?? null);
    });

    return () => {
      isMounted = false;
      urlSubscription.remove();
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
