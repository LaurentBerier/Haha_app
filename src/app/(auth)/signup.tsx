import * as AppleAuthentication from 'expo-apple-authentication';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../../i18n';
import { signInWithApple, signUpWithEmail } from '../../services/authService';
import { theme } from '../../theme';

export default function SignupScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [showVerifyMessage, setShowVerifyMessage] = useState(false);

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

    if (password !== confirmPassword) {
      setError(t('signupPasswordsMismatch'));
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await signUpWithEmail(email.trim(), password);
      if (result.session && !result.confirmationRequired) {
        router.replace('/');
      } else {
        setShowVerifyMessage(true);
      }
    } catch (err) {
      console.error('[Signup] signUpWithEmail failed', err);
      const message = formatAuthError(err, t('signupError'));
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
      console.error('[Signup] signInWithApple failed', err);
      const message = formatAuthError(err, t('signupAppleError'));
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (showVerifyMessage) {
    return (
      <View style={styles.screen} testID="signup-screen">
        <Text style={styles.title}>{t('signupVerifyEmailTitle')}</Text>
        <Text style={styles.subtitle}>{t('signupVerifyEmailBody')}</Text>
        <Link href="/(auth)/login" asChild>
          <Pressable>
            <Text style={styles.link}>{t('signupBackToLogin')}</Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="signup-screen">
      <Text style={styles.title}>{t('signupTitle')}</Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder={t('signupEmailPlaceholder')}
        placeholderTextColor={theme.colors.textDisabled}
        keyboardType="email-address"
        autoCapitalize="none"
        style={styles.input}
      />

      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder={t('signupPasswordPlaceholder')}
        placeholderTextColor={theme.colors.textDisabled}
        secureTextEntry
        style={styles.input}
      />

      <TextInput
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder={t('signupConfirmPasswordPlaceholder')}
        placeholderTextColor={theme.colors.textDisabled}
        secureTextEntry
        style={styles.input}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={onSubmit}
        disabled={isSubmitting || !email.trim() || !password || !confirmPassword}
      >
        {isSubmitting ? (
          <ActivityIndicator color={theme.colors.textPrimary} />
        ) : (
          <Text style={styles.buttonLabel}>{t('signupSubmit')}</Text>
        )}
      </Pressable>

      {appleAvailable ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={12}
          style={styles.appleButton}
          onPress={onApple}
        />
      ) : null}

      <Link href="/(auth)/login" asChild>
        <Pressable>
          <Text style={styles.link}>{t('signupAlreadyHaveAccount')}</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    backgroundColor: theme.colors.background,
    gap: theme.spacing.md
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 30,
    fontWeight: '700'
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 16,
    lineHeight: 22
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
