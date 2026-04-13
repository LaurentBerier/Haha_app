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
import { signInWithApple, signInWithEmail } from '../../services/authService';
import { theme } from '../../theme';

export default function LoginScreen() {
  const emailKeyboardType: 'email-address' | 'ascii-capable' =
    Platform.OS === 'ios' ? 'ascii-capable' : 'email-address';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  const formatAuthError = (error: unknown, fallback: string): string => {
    if (error instanceof Error) {
      const message = error.message.trim();
      if (/network request failed|failed to fetch/i.test(message)) {
        return t('authNetworkError');
      }
      if (message) {
        return message;
      }
    }

    return fallback;
  };

  useEffect(() => {
    const checkAppleAvailability = async () => {
      const available = await AppleAuthentication.isAvailableAsync();
      setAppleAvailable(available);
    };

    checkAppleAvailability().catch(() => setAppleAvailable(false));
  }, []);

  const onSubmit = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      await signInWithEmail(email.trim(), password);
      router.replace('/');
    } catch (err) {
      console.error('[Login] signInWithEmail failed', err);
      const message = formatAuthError(err, t('loginError'));
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onApple = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      await signInWithApple();
      router.replace('/');
    } catch (err) {
      console.error('[Login] signInWithApple failed', err);
      const message = formatAuthError(err, t('loginAppleError'));
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.screen}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
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

            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={t('loginPasswordPlaceholder')}
              placeholderTextColor={theme.colors.textDisabled}
              secureTextEntry
              style={styles.input}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.button, isSubmitting && styles.buttonDisabled]}
              onPress={onSubmit}
              disabled={isSubmitting || !email.trim() || !password}
            >
              {isSubmitting ? (
                <ActivityIndicator color={theme.colors.textPrimary} />
              ) : (
                <Text style={styles.buttonLabel}>{t('loginSubmit')}</Text>
              )}
            </Pressable>

            {appleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={12}
                style={styles.appleButton}
                onPress={onApple}
              />
            ) : null}

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
  link: {
    marginTop: theme.spacing.xs,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    fontWeight: '600'
  },
  error: {
    color: theme.colors.error,
    fontSize: 13
  }
});
