import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Game } from '../../games/types';
import { t } from '../../i18n';
import { theme } from '../../theme';

interface GameOverPanelProps {
  game: Game;
  onReplay: () => void;
  onExit: () => void;
}

function resolveWinnerCopy(winner: Game['winner']) {
  if (winner === 'user') {
    return t('gameOverWinnerUser');
  }
  if (winner === 'artist') {
    return t('gameOverWinnerArtist');
  }
  return t('gameOverTie');
}

export function GameOverPanel({ game, onReplay, onExit }: GameOverPanelProps) {
  return (
    <View style={styles.card} testID="roast-duel-game-over-panel">
      <Text style={styles.title}>{t('gameOverTitle')}</Text>
      <Text style={styles.winner}>{resolveWinnerCopy(game.winner)}</Text>
      <Text style={styles.score}>{`Toi ${game.userTotalScore.toFixed(1)} - Cathy ${game.artistTotalScore.toFixed(1)}`}</Text>

      <View style={styles.actions}>
        <Pressable
          onPress={onReplay}
          style={({ pressed }) => [styles.replayButton, pressed ? styles.buttonPressed : null]}
          accessibilityRole="button"
          testID="roast-duel-replay"
        >
          <Text style={styles.replayLabel}>{t('gameOverReplay')}</Text>
        </Pressable>
        <Pressable
          onPress={onExit}
          style={({ pressed }) => [styles.exitButton, pressed ? styles.buttonPressed : null]}
          accessibilityRole="button"
          testID="roast-duel-exit"
        >
          <Text style={styles.exitLabel}>{t('gameOverExit')}</Text>
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
    gap: theme.spacing.sm
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '800'
  },
  winner: {
    color: theme.colors.neonBlue,
    fontSize: 14,
    fontWeight: '700'
  },
  score: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm
  },
  replayButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlue,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceRaised
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
    borderWidth: 1.4,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSunken
  },
  exitLabel: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '700'
  },
  buttonPressed: {
    opacity: 0.94
  }
});
