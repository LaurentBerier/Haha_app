import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { assertSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { theme } from '../../theme';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    code?: string;
    token_hash?: string;
    type?: string;
    flow?: string;
    access_token?: string;
    refresh_token?: string;
  }>();

  useEffect(() => {
    let isMounted = true;

    const resolveCallback = async () => {
      try {
        assertSupabaseConfigured();

        const incomingUrl = await Linking.getInitialURL();
        const url = incomingUrl ? new URL(incomingUrl) : null;
        const hash = new URLSearchParams(url?.hash.replace(/^#/, ''));
        const query = url?.searchParams ?? new URLSearchParams();

        const code = query.get('code') ?? params.code ?? null;
        const tokenHash = query.get('token_hash') ?? hash.get('token_hash') ?? params.token_hash ?? null;
        const type = (query.get('type') ?? hash.get('type') ?? params.type ?? null) as
          | 'signup'
          | 'email'
          | 'recovery'
          | 'invite'
          | 'magiclink'
          | 'email_change'
          | null;
        const flow = query.get('flow') ?? params.flow ?? null;
        const accessToken = query.get('access_token') ?? hash.get('access_token') ?? params.access_token ?? null;
        const refreshToken = query.get('refresh_token') ?? hash.get('refresh_token') ?? params.refresh_token ?? null;

        if (accessToken && refreshToken) {
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
        } else if (code && incomingUrl) {
          const { error } = await supabase.auth.exchangeCodeForSession(incomingUrl);
          if (error && __DEV__) {
            console.warn('[AuthCallback] exchangeCodeForSession failed:', error.message);
          }
        } else if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type
          });
          if (error && __DEV__) {
            console.warn('[AuthCallback] verifyOtp failed:', error.message);
          }
        }

        if (!isMounted) {
          return;
        }

        const isRecovery = flow === 'recovery' || type === 'recovery';
        router.replace(isRecovery ? '/(auth)/reset-password' : '/');
      } catch (error) {
        if (__DEV__) {
          console.warn('[AuthCallback] Callback handling failed:', error);
        }
        if (isMounted) {
          router.replace('/');
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
      <Text style={styles.title}>Confirmation reçue</Text>
      <Text style={styles.subtitle}>Redirection en cours...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.lg
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: theme.spacing.xs
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 14
  }
});
