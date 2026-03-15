import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

interface GameCardProps {
  emoji: string;
  title: string;
  description: string;
  onPress: () => void;
  testID?: string;
}

export function GameCard({ emoji, title, description, onPress, testID }: GameCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
      accessibilityRole="button"
      testID={testID}
    >
      <Text style={styles.emoji}>{emoji}</Text>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.7,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4
  },
  cardHover: {
    borderColor: theme.colors.neonBlue
  },
  cardPressed: {
    opacity: 0.96
  },
  emoji: {
    fontSize: 28
  },
  content: {
    flex: 1,
    gap: 3
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800'
  },
  description: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17
  },
  chevron: {
    color: theme.colors.textMuted,
    fontSize: 24
  }
});
