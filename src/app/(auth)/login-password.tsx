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
import { signInWithEmail } from '../../services/authService';
import { theme } from '../../theme';

export default function LoginPasswordScreen() {
  const emailKeyboardType: 'email-address' | 'ascii-capable' =
    Platform.OS === 'ios' ? 'ascii-capable' : 'email-address';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    setIsSubmitting(true);

    try {
      await signInWithEmail(email.trim(), password);
      router.replace('/');
    } catch (err) {
      console.error('[LoginPassword] signInWithEmail failed', err);
      const message = formatAuthError(err, t('loginError'));
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
      <TouchableWithoutFeedback onPress={dismissKeyboardOnBackgroundPress} accessible={false}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.form} testID="login-password-screen">
            <Text style={styles.title}>{t('loginPasswordTitle')}</Text>
            <Text style={styles.subtitle}>{t('loginPasswordSubtitle')}</Text>

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

            <Link href="/(auth)/forgot-password" asChild>
              <Pressable>
                <Text style={styles.link}>{t('loginForgotPassword')}</Text>
              </Pressable>
            </Link>

            <Link href="/(auth)/login" asChild>
              <Pressable>
                <Text style={styles.link}>{t('loginUseMagicLink')}</Text>
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
