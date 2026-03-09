import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '../../theme';

interface BackButtonProps {
  testID?: string;
}

export function BackButton({ testID = 'universal-back' }: BackButtonProps) {
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/');
  };

  return (
    <Pressable
      testID={testID}
      style={styles.backButton}
      onPress={handleBack}
      accessibilityRole="button"
      accessibilityLabel="back"
    >
      <Text style={styles.backText}>‹</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface
  },
  backText: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    lineHeight: 24,
    marginTop: -2
  }
});
