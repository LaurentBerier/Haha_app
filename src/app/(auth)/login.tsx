import * as AppleAuthentication from 'expo-apple-authentication';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { signInWithApple, signInWithEmail } from '../../services/authService';
import { theme } from '../../theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  const onSubmit = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      await signInWithEmail(email.trim(), password);
      router.replace('/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Impossible de se connecter.';
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
      const message = err instanceof Error ? err.message : 'Connexion Apple impossible.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.screen} testID="login-screen">
      <Text style={styles.title}>Se connecter</Text>
      <Text style={styles.subtitle}>Accède à ton compte Ha-Ha.ai</Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor={theme.colors.textDisabled}
        keyboardType="email-address"
        autoCapitalize="none"
        style={styles.input}
      />

      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Mot de passe"
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
        {isSubmitting ? <ActivityIndicator color={theme.colors.textPrimary} /> : <Text style={styles.buttonLabel}>Se connecter</Text>}
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

      <Link href="/(auth)/signup" asChild>
        <Pressable>
          <Text style={styles.link}>Créer un compte</Text>
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
