import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

interface GameResultPanelProps {
  title: string;
  subtitle: string;
  scoreLabel?: string;
  replayLabel: string;
  exitLabel: string;
  onReplay: () => void;
  onExit: () => void;
  testID?: string;
}

export function GameResultPanel({
  title,
  subtitle,
  scoreLabel,
  replayLabel,
  exitLabel,
  onReplay,
  onExit,
  testID
}: GameResultPanelProps) {
  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {scoreLabel ? <Text style={styles.score}>{scoreLabel}</Text> : null}

      <View style={styles.actions}>
        <Pressable
          onPress={onReplay}
          style={({ hovered, pressed }) => [styles.replayButton, hovered ? styles.buttonHover : null, pressed ? styles.buttonPressed : null]}
          accessibilityRole="button"
        >
          <Text style={styles.replayLabel}>{replayLabel}</Text>
        </Pressable>
        <Pressable
          onPress={onExit}
          style={({ hovered, pressed }) => [styles.exitButton, hovered ? styles.buttonHover : null, pressed ? styles.buttonPressed : null]}
          accessibilityRole="button"
        >
          <Text style={styles.exitLabel}>{exitLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.xs
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '800'
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 18
  },
  score: {
    marginTop: 2,
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700'
  },
  actions: {
    marginTop: theme.spacing.xs,
    flexDirection: 'row',
    gap: theme.spacing.sm
  },
  replayButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  replayLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  },
  exitButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center'
  },
  exitLabel: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '700'
  },
  buttonHover: {
    borderColor: theme.colors.neonBlueSoft
  },
  buttonPressed: {
    opacity: 0.95
  }
});

