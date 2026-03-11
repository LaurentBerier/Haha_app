import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '../../theme';

interface VraiInventeCardProps {
  index: number;
  text: string;
  isRevealed: boolean;
  isSelected: boolean;
  isTrue: boolean;
  disabled: boolean;
  onPress: (index: number) => void;
}

export function VraiInventeCard({
  index,
  text,
  isRevealed,
  isSelected,
  isTrue,
  disabled,
  onPress
}: VraiInventeCardProps) {
  const revealStyle = isRevealed ? (isTrue ? styles.correctCard : styles.falseCard) : null;

  return (
    <Pressable
      onPress={() => onPress(index)}
      disabled={disabled}
      style={({ hovered, pressed }) => [
        styles.card,
        isSelected ? styles.selectedCard : null,
        revealStyle,
        hovered && !disabled ? styles.cardHover : null,
        pressed && !disabled ? styles.cardPressed : null,
        disabled && !isRevealed ? styles.cardDisabled : null
      ]}
      accessibilityRole="button"
      testID={`vrai-ou-invente-option-${index}`}
    >
      <Text style={styles.index}>{String(index + 1)}</Text>
      <Text style={styles.text}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.4,
    borderColor: theme.colors.border,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm
  },
  cardHover: {
    borderColor: theme.colors.neonBlueSoft
  },
  cardPressed: {
    opacity: 0.96
  },
  cardDisabled: {
    opacity: 0.84
  },
  selectedCard: {
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceRaised
  },
  correctCard: {
    borderColor: '#1fa25e',
    backgroundColor: 'rgba(31,162,94,0.12)'
  },
  falseCard: {
    borderColor: theme.colors.error,
    backgroundColor: 'rgba(255,90,95,0.12)'
  },
  index: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
    width: 18,
    textAlign: 'center',
    marginTop: 1
  },
  text: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19,
    flex: 1
  }
});

