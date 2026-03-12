import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '../../theme';

interface BackButtonProps {
  testID?: string;
  onPress?: () => void;
}

export function BackButton({ testID = 'universal-back', onPress }: BackButtonProps) {
  const handleBack = () => {
    if (onPress) {
      onPress();
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/');
  };

  return (
    <Pressable
      testID={testID}
      style={({ hovered, pressed }) => [
        styles.backButton,
        hovered ? styles.backButtonHover : null,
        pressed ? styles.backButtonPressed : null
      ]}
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
  backButtonHover: {
    borderColor: theme.colors.neonBlueSoft,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3
  },
  backButtonPressed: {
    opacity: 0.94
  },
  backText: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    lineHeight: 24,
    marginTop: -2
  }
});
