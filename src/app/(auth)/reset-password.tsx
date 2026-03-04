import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { updatePassword } from '../../services/authService';
import { theme } from '../../theme';

export default function ResetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setSuccess(false);

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    setIsSubmitting(true);
    try {
      await updatePassword(password);
      setSuccess(true);
      setTimeout(() => {
        router.replace('/(auth)/login');
      }, 700);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Impossible de mettre à jour le mot de passe.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.screen} testID="reset-password-screen">
      <Text style={styles.title}>Nouveau mot de passe</Text>
      <Text style={styles.subtitle}>Choisis un nouveau mot de passe pour ton compte.</Text>

      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Nouveau mot de passe"
        placeholderTextColor={theme.colors.textDisabled}
        secureTextEntry
        style={styles.input}
      />

      <TextInput
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="Confirmer le mot de passe"
        placeholderTextColor={theme.colors.textDisabled}
        secureTextEntry
        style={styles.input}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {success ? <Text style={styles.success}>Mot de passe mis à jour. Redirection...</Text> : null}

      <Pressable
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={onSubmit}
        disabled={isSubmitting || !password || !confirmPassword}
      >
        {isSubmitting ? (
          <ActivityIndicator color={theme.colors.textPrimary} />
        ) : (
          <Text style={styles.buttonLabel}>Mettre à jour</Text>
        )}
      </Pressable>
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
  error: {
    color: theme.colors.error,
    fontSize: 13
  },
  success: {
    color: theme.colors.textSecondary,
    fontSize: 13
  }
});
