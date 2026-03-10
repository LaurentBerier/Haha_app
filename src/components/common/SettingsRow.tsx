import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

interface SettingsRowProps {
  label: string;
  value?: string;
  onPress?: () => void;
  isDestructive?: boolean;
  showChevron?: boolean;
  testID?: string;
}

export function SettingsRow({
  label,
  value,
  onPress,
  isDestructive = false,
  showChevron = true,
  testID
}: SettingsRowProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        onPress && pressed ? styles.pressed : null,
        !onPress ? styles.disabled : null
      ]}
    >
      <Text style={[styles.label, isDestructive && styles.destructive]}>{label}</Text>
      <View style={styles.trailing}>
        {value ? <Text style={styles.value}>{value}</Text> : null}
        {showChevron ? <Text style={styles.chevron}>›</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.45,
    borderColor: theme.colors.neonBlueSoft,
    paddingHorizontal: theme.spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3
  },
  pressed: {
    opacity: 0.94,
    transform: [{ scale: 0.995 }]
  },
  disabled: {
    opacity: 1
  },
  label: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  },
  destructive: {
    color: theme.colors.error
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm
  },
  value: {
    color: theme.colors.textSecondary,
    fontSize: 13
  },
  chevron: {
    color: theme.colors.textMuted,
    fontSize: 20,
    lineHeight: 20
  }
});
