import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MODE_IDS } from '../../config/constants';
import type { Mode } from '../../models/Mode';
import { theme } from '../../theme';

interface ModeCardProps {
  mode: Mode;
  onPress: () => void;
}

const MODE_EMOJI_BY_ID: Record<string, string> = {
  [MODE_IDS.RADAR_ATTITUDE]: '🔥',
  [MODE_IDS.ROAST]: '😈',
  [MODE_IDS.COACH_DE_VIE]: '🧭',
  [MODE_IDS.PHRASE_DU_JOUR]: '💬',
  [MODE_IDS.MESSAGE_PERSONNALISE]: '🎁',
  [MODE_IDS.NUMERO_DE_SHOW]: '🎤',
  [MODE_IDS.HOROSCOPE]: '🔮',
  [MODE_IDS.METEO]: '⛅'
};

const MODE_EMOJI_FALLBACK_POOL = ['🎭', '🎯', '⚡', '🧨', '🗣️', '🧠', '🎬', '🤹', '🧩', '🎪'];

function hashModeId(modeId: string): number {
  let hash = 0;
  for (const char of modeId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function getModeEmoji(mode: Mode): string {
  if (mode.emoji) {
    return mode.emoji;
  }

  const mapped = MODE_EMOJI_BY_ID[mode.id];
  if (mapped) {
    return mapped;
  }

  const index = hashModeId(mode.id) % MODE_EMOJI_FALLBACK_POOL.length;
  return MODE_EMOJI_FALLBACK_POOL[index] ?? '🎭';
}

export function ModeCard({ mode, onPress }: ModeCardProps) {
  const emoji = getModeEmoji(mode);
  const isHistoryMode = mode.kind === MODE_IDS.HISTORY;

  return (
    <Pressable
      testID={`mode-card-${mode.id}`}
      accessibilityRole="button"
      accessibilityLabel={mode.name}
      onPress={onPress}
      style={({ pressed }) => [styles.card, isHistoryMode && styles.cardHistory, pressed && styles.pressed]}
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
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: theme.spacing.md,
    shadowColor: theme.colors.shadowMode,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2
  },
  cardHistory: {
    backgroundColor: theme.colors.surface,
    borderStyle: 'dashed',
    borderColor: theme.colors.border
  },
  pressed: {
    opacity: 0.9
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
    fontSize: 15,
    fontWeight: '700'
  },
  description: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17
  }
});
