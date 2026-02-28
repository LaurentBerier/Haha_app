import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

export default function AuthCallbackScreen() {
  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/');
    }, 700);

    return () => {
      clearTimeout(timer);
    };
  }, []);

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
