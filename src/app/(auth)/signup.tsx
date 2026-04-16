import { Link, router } from 'expo-router';
import { useState } from 'react';
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
import { signUpWithEmail } from '../../services/authService';
import { theme } from '../../theme';

export default function SignUpScreen() {
  const emailKeyboardType: 'email-address' | 'ascii-capable' =
    Platform.OS === 'ios' ? 'ascii-capable' : 'email-address';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const dismissKeyboardOnBackgroundPress = Platform.OS === 'web' ? undefined : Keyboard.dismiss;

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

  const onSubmit = async () => {
    setError(null);

    if (password !== confirmPassword) {
      setError(t('signupPasswordsMismatch'));
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await signUpWithEmail(email.trim(), password);

      if (result.confirmationRequired) {
        setConfirmationRequired(true);
      } else {
        router.replace('/');
      }
    } catch (err) {
      console.error('[SignUp] signUpWithEmail failed', err);
      const message = formatAuthError(err, t('signupError'));
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (confirmationRequired) {
    return (
      <View style={styles.screen}>
        <View style={styles.confirmationContainer}>
          <Text style={styles.title}>{t('signupVerifyEmailTitle')}</Text>
          <Text style={styles.confirmationBody}>{t('signupVerifyEmailBody')}</Text>

          <Link href="/(auth)/login" asChild>
            <Pressable style={styles.button}>
              <Text style={styles.buttonLabel}>{t('signupBackToLogin')}</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    );
  }

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
          <View style={styles.form} testID="signup-screen">
            <Text style={styles.title}>{t('signupTitle')}</Text>

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t('signupEmailPlaceholder')}
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
              placeholder={t('signupPasswordPlaceholder')}
              placeholderTextColor={theme.colors.textDisabled}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              style={styles.input}
            />

            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder={t('signupConfirmPasswordPlaceholder')}
              placeholderTextColor={theme.colors.textDisabled}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
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

            <Link href="/(auth)/login" asChild>
              <Pressable>
                <Text style={styles.link}>{t('signupAlreadyHaveAccount')}</Text>
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
  confirmationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md
  },
  confirmationBody: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 420
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 30,
    fontWeight: '700'
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
