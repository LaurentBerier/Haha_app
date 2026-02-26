import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Mode } from '../../models/Mode';
import { theme } from '../../theme';

interface ModeCardProps {
  mode: Mode;
  onPress: () => void;
}

const MODE_EMOJI_BY_ID: Record<string, string> = {
  'radar-attitude': '🔥',
  roast: '😈',
  'coach-de-vie': '🧭',
  'phrase-du-jour': '💬',
  'message-personnalise': '🎁',
  'numero-de-show': '🎤',
  horoscope: '🔮',
  meteo: '⛅'
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

  return (
    <Pressable
      testID={`mode-card-${mode.id}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        <View style={styles.emojiContainer}>
          <Text style={styles.emoji}>{emoji}</Text>
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
  emojiContainer: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a3145'
  },
  emoji: {
    fontSize: 20,
    lineHeight: 22
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
