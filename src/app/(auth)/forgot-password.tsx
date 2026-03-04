import { Link } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { requestPasswordReset } from '../../services/authService';
import { theme } from '../../theme';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setSuccess(false);
    setIsSubmitting(true);

    try {
      await requestPasswordReset(email.trim());
      setSuccess(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Impossible d’envoyer le lien.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.screen} testID="forgot-password-screen">
      <Text style={styles.title}>Mot de passe oublié</Text>
      <Text style={styles.subtitle}>Entre ton email pour recevoir un lien de réinitialisation.</Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor={theme.colors.textDisabled}
        keyboardType="email-address"
        autoCapitalize="none"
        style={styles.input}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {success ? <Text style={styles.success}>Email envoyé. Vérifie ta boîte de réception.</Text> : null}

      <Pressable style={[styles.button, isSubmitting && styles.buttonDisabled]} onPress={onSubmit} disabled={isSubmitting || !email.trim()}>
        {isSubmitting ? <ActivityIndicator color={theme.colors.textPrimary} /> : <Text style={styles.buttonLabel}>Envoyer le lien</Text>}
      </Pressable>

      <Link href="/(auth)/login" asChild>
        <Pressable>
          <Text style={styles.link}>Retour à la connexion</Text>
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
    fontSize: 14
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
  },
  success: {
    color: theme.colors.textSecondary,
    fontSize: 13
  }
});
