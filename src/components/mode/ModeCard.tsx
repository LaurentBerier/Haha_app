import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Mode } from '../../models/Mode';
import { theme } from '../../theme';

interface ModeCardProps {
  mode: Mode;
  onPress: () => void;
}

export function ModeCard({ mode, onPress }: ModeCardProps) {
  return (
    <Pressable
      testID={`mode-card-${mode.id}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        <Text style={styles.emoji}>{mode.emoji ?? '🎭'}</Text>
        <View style={styles.content}>
          <Text style={styles.title}>{mode.name}</Text>
          <Text style={styles.description} numberOfLines={3}>
            {mode.description}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: theme.spacing.md
  },
  pressed: {
    opacity: 0.88
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    alignItems: 'flex-start'
  },
  emoji: {
    fontSize: 24,
    lineHeight: 28
  },
  content: {
    flex: 1,
    gap: theme.spacing.xs
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
  },
  description: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18
  }
});
