import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';

interface TarotCardProps {
  index: number;
  cardName: string;
  emoji: string;
  interpretation: string;
  isFlipped: boolean;
  isSelected?: boolean;
  mode: 'selection' | 'reveal';
  disabled: boolean;
  onPress: (index: number) => void;
}

export function TarotCard({
  index,
  cardName,
  emoji,
  interpretation,
  isFlipped,
  isSelected = false,
  mode,
  disabled,
  onPress
}: TarotCardProps) {
  const reduceMotion = useStore((state) => state.reduceMotion);
  const skipAnimation = reduceMotion === 'on';

  const rotateAnim = useRef(new Animated.Value(isFlipped ? 1 : 0)).current;

  useEffect(() => {
    if (!isFlipped) {
      return;
    }
    if (skipAnimation) {
      rotateAnim.setValue(1);
      return;
    }
    Animated.timing(rotateAnim, {
      toValue: 1,
      duration: 380,
      useNativeDriver: true
    }).start();
  }, [isFlipped, rotateAnim, skipAnimation]);

  const frontRotateY = rotateAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['0deg', '90deg', '90deg']
  });

  const backRotateY = rotateAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-90deg', '-90deg', '0deg']
  });

  if (mode === 'selection') {
    return (
      <Pressable
        onPress={() => onPress(index)}
        disabled={disabled}
        style={({ pressed }) => [
          styles.selectionCard,
          isSelected && styles.selectionCardSelected,
          pressed && !disabled ? styles.cardPressed : null,
          disabled && !isSelected ? styles.cardDisabled : null
        ]}
        accessibilityRole="button"
        accessibilityLabel={isSelected ? `Carte sélectionnée ${index + 1}` : `Choisir carte ${index + 1}`}
        testID={`tarot-pool-card-${index}`}
      >
        <Text style={styles.selectionEmoji}>🎴</Text>
        {isSelected && <View style={styles.selectionBadge} />}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => !isFlipped && !disabled ? onPress(index) : undefined}
      disabled={isFlipped || disabled}
      style={[styles.revealCardContainer]}
      accessibilityRole="button"
      accessibilityLabel={isFlipped ? `${cardName} révélée` : `Touche pour révéler la carte ${index + 1}`}
      testID={`tarot-card-${index}`}
    >
      <Animated.View
        style={[
          styles.cardFace,
          styles.cardFront,
          { transform: [{ perspective: 1000 }, { rotateY: frontRotateY }] }
        ]}
      >
        <Text style={styles.cardBackEmoji}>🔮</Text>
        <Text style={styles.cardBackLabel}>Touche pour{'\n'}révéler</Text>
      </Animated.View>

      <Animated.View
        style={[
          styles.cardFace,
          styles.cardBack,
          { transform: [{ perspective: 1000 }, { rotateY: backRotateY }] }
        ]}
      >
        <Text style={styles.revealEmoji}>{emoji}</Text>
        <Text style={styles.revealName}>{cardName}</Text>
        <Text style={styles.revealInterpretation}>{interpretation}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  selectionCard: {
    width: 64,
    height: 96,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center'
  },
  selectionCardSelected: {
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceRaised
  },
  selectionEmoji: {
    fontSize: 28
  },
  selectionBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.neonBlue
  },
  cardPressed: {
    opacity: 0.85
  },
  cardDisabled: {
    opacity: 0.6
  },
  revealCardContainer: {
    width: '100%',
    minHeight: 200,
    position: 'relative'
  },
  cardFace: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 14,
    borderWidth: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
    minHeight: 200
  },
  cardFront: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    gap: 8
  },
  cardBack: {
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: theme.colors.surfaceRaised,
    gap: 6,
    justifyContent: 'flex-start',
    alignItems: 'flex-start'
  },
  cardBackEmoji: {
    fontSize: 36
  },
  cardBackLabel: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    textAlign: 'center'
  },
  revealEmoji: {
    fontSize: 34,
    marginBottom: 4
  },
  revealName: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8
  },
  revealInterpretation: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 20
  }
});
