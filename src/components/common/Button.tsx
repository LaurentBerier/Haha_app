import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '../../theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

export function Button({ label, onPress, disabled, testID }: ButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing.lg,
    justifyContent: 'center',
    alignItems: 'center'
  },
  pressed: {
    opacity: 0.9
  },
  disabled: {
    opacity: 0.5
  },
  label: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
  }
});
