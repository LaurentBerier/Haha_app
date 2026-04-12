import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Mode } from '../../models/Mode';
import { theme } from '../../theme';
import { MODE_IDS } from '../../config/constants';
import { getModeEmoji } from '../../utils/modeIcon';

interface ModeCardProps {
  mode: Mode;
  onPress: () => void;
  disabled?: boolean;
}

export function ModeCard({ mode, onPress, disabled = false }: ModeCardProps) {
  const emoji = getModeEmoji(mode);
  const isHistoryMode = mode.kind === MODE_IDS.HISTORY;

  return (
    <Pressable
      testID={`mode-card-${mode.id}`}
      accessibilityRole="button"
      accessibilityLabel={mode.name}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.card,
        isHistoryMode && styles.cardHistory,
        disabled && styles.disabled,
        pressed && styles.pressed
      ]}
    >
      <View style={styles.row}>
        <View style={[styles.emojiContainer, isHistoryMode && styles.emojiContainerHistory]}>
          <Text style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {emoji}
          </Text>
        </View>
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
    backgroundColor: theme.colors.surfaceRaised,
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 12,
    padding: theme.spacing.sm + 1,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5
  },
  cardHistory: {
    backgroundColor: theme.colors.surface,
    borderStyle: 'dashed',
    borderColor: theme.colors.border,
    shadowOpacity: 0.1
  },
  pressed: {
    opacity: 0.94,
    transform: [{ scale: 0.995 }]
  },
  disabled: {
    opacity: 0.45
  },
  hovered: {
    borderColor: theme.colors.neonBlue,
    shadowOpacity: 0.34
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'flex-start'
  },
  emojiContainer: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceButton
  },
  emojiContainerHistory: {
    backgroundColor: theme.colors.border
  },
  emoji: {
    fontSize: 17,
    lineHeight: 20
  },
  content: {
    flex: 1,
    gap: theme.spacing.xs
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  },
  description: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 16
  }
});
