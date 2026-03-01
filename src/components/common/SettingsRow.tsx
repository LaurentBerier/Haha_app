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
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  pressed: {
    opacity: 0.9
  },
  disabled: {
    opacity: 1
  },
  label: {
    color: theme.colors.textPrimary,
    fontSize: 15,
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
    fontSize: 14
  },
  chevron: {
    color: theme.colors.textMuted,
    fontSize: 20,
    lineHeight: 20
  }
});
