import * as AppleAuthentication from 'expo-apple-authentication';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import { t } from '../../i18n';
import { requestMagicLink, signInWithApple } from '../../services/authService';
import { theme } from '../../theme';

const MAGIC_LINK_COOLDOWN_SECONDS = 45;
const AUTH_FORM_MAX_WIDTH = 608;

function parseRetryAfterSeconds(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const value = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function isAppleRequestCancelled(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const withCode = error as { code?: unknown; message?: unknown };
  const code = typeof withCode.code === 'string' ? withCode.code.toLowerCase() : '';
  const message = typeof withCode.message === 'string' ? withCode.message.toLowerCase() : '';
  return code.includes('canceled') || message.includes('canceled') || message.includes('cancelled');
}

export default function LoginScreen() {
  const emailKeyboardType: 'email-address' | 'ascii-capable' =
    Platform.OS === 'ios' ? 'ascii-capable' : 'email-address';

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);
  const [isAppleSubmitting, setIsAppleSubmitting] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const dismissKeyboardOnBackgroundPress = Platform.OS === 'web' ? undefined : Keyboard.dismiss;

  const formatAuthError = (error: unknown, fallback: string): string => {
    if (error && typeof error === 'object') {
      const maybeCode = (error as { code?: unknown }).code;
      if (typeof maybeCode === 'string' && maybeCode === 'RATE_LIMIT_EXCEEDED') {
        return t('authMagicLinkRateLimitError');
      }
    }

    if (error instanceof Error) {
      const message = error.message.trim();
      if (/network request failed|failed to fetch/i.test(message)) {
        return t('authNetworkError');
      }
      if (/apple sign-in est indisponible|apple sign-in is unavailable|apple sign-in n'est pas disponible/i.test(message)) {
        return t('authAppleUnavailableError');
      }
      if (message) {
        return message;
      }
    }

    return fallback;
  };

  useEffect(() => {
    const checkAppleAvailability = async () => {
      if (Platform.OS === 'web') {
        setAppleAvailable(true);
        return;
      }

      const available = await AppleAuthentication.isAvailableAsync();
      setAppleAvailable(available);
    };

    checkAppleAvailability().catch(() => setAppleAvailable(false));
  }, []);

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return;
    }

    const timer = setInterval(() => {
      setCooldownSeconds((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [cooldownSeconds]);

  const onSubmit = async () => {
    setError(null);
    setMagicLinkSent(false);

    if (cooldownSeconds > 0) {
      return;
    }

    setIsEmailSubmitting(true);

    try {
      await requestMagicLink(email.trim(), 'signin');
      setMagicLinkSent(true);
      setCooldownSeconds(MAGIC_LINK_COOLDOWN_SECONDS);
    } catch (err) {
      console.error('[Login] requestMagicLink failed', err);
      const retryAfterSeconds = parseRetryAfterSeconds(err);
      if (retryAfterSeconds !== null) {
        setCooldownSeconds(retryAfterSeconds);
      }
      const message = formatAuthError(err, t('authMagicLinkError'));
      setError(message);
    } finally {
      setIsEmailSubmitting(false);
    }
  };

  const onApple = async () => {
    setError(null);
    setIsAppleSubmitting(true);

    try {
      await signInWithApple();
      if (Platform.OS !== 'web') {
        router.replace('/');
      }
    } catch (err) {
      if (isAppleRequestCancelled(err)) {
        return;
      }
      console.error('[Login] signInWithApple failed', err);
      const message = formatAuthError(err, t('loginAppleError'));
      setError(message);
    } finally {
      setIsAppleSubmitting(false);
    }
  };

  const isSubmitting = isEmailSubmitting || isAppleSubmitting;
  const emailButtonLabel =
    cooldownSeconds > 0 ? `${t('authMagicLinkResendIn')} ${cooldownSeconds}s` : t('loginContinueWithEmail');

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.screen}
    >
      <TouchableWithoutFeedback onPress={dismissKeyboardOnBackgroundPress} accessible={false}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.form} testID="login-screen">
            <Text style={styles.title}>{t('loginTitle')}</Text>
            <Text style={styles.subtitle}>{t('loginSubtitle')}</Text>

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t('loginEmailPlaceholder')}
              placeholderTextColor={theme.colors.textDisabled}
              keyboardType={emailKeyboardType}
              inputMode="email"
              textContentType="emailAddress"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              style={styles.input}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {magicLinkSent ? <Text style={styles.success}>{t('authMagicLinkSentNeutral')}</Text> : null}

            <Pressable
              style={[styles.button, isSubmitting && styles.buttonDisabled]}
              onPress={onSubmit}
              disabled={isSubmitting || !email.trim() || cooldownSeconds > 0}
            >
              {isEmailSubmitting ? (
                <ActivityIndicator color={theme.colors.textPrimary} />
              ) : (
                <Text style={styles.buttonLabel}>{emailButtonLabel}</Text>
              )}
            </Pressable>

            {appleAvailable ? (
              Platform.OS === 'web' ? (
                <Pressable
                  style={[styles.appleButtonFallback, isSubmitting && styles.buttonDisabled]}
                  onPress={onApple}
                  disabled={isSubmitting}
                >
                  {isAppleSubmitting ? (
                    <ActivityIndicator color={'#111827'} />
                  ) : (
                    <Text style={styles.appleButtonFallbackLabel}>{t('loginAppleCta')}</Text>
                  )}
                </Pressable>
              ) : (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={12}
                  style={styles.appleButton}
                  onPress={onApple}
                />
              )
            ) : null}

            <Link href="/(auth)/login-password" asChild>
              <Pressable>
                <Text style={styles.link}>{t('loginUsePassword')}</Text>
              </Pressable>
            </Link>

            <Link href="/(auth)/forgot-password" asChild>
              <Pressable>
                <Text style={styles.link}>{t('loginForgotPassword')}</Text>
              </Pressable>
            </Link>

            <Link href="/(auth)/signup" asChild>
              <Pressable>
                <Text style={styles.link}>{t('loginCreateAccount')}</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  scroll: {
    flex: 1
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.xl
  },
  form: {
    width: '100%',
    maxWidth: AUTH_FORM_MAX_WIDTH,
    alignSelf: 'center',
    gap: theme.spacing.md
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 30,
    fontWeight: '700'
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    marginBottom: theme.spacing.sm
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: theme.colors.textPrimary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    fontSize: 16
  },
  button: {
    height: 48,
    borderRadius: 12,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonDisabled: {
    opacity: 0.7
  },
  buttonLabel: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
  },
  appleButton: {
    width: '100%',
    height: 48
  },
  appleButtonFallback: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderColor: '#D1D5DB',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  appleButtonFallbackLabel: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '700'
  },
  link: {
    marginTop: theme.spacing.xs,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    fontWeight: '600'
  },
  error: {
    color: theme.colors.error,
    fontSize: 13
  },
  success: {
    color: theme.colors.textSecondary,
    fontSize: 13
  }
});
