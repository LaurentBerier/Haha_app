import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../../i18n';
import type { JudgeScore, RoastRound } from '../../games/types';
import { theme } from '../../theme';

interface RoundResultPanelProps {
  roundNumber: number;
  totalRounds: number;
  round: RoastRound;
  onNext: () => void;
  isFinalRound: boolean;
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  const width = `${Math.max(0, Math.min(100, value * 10))}%` as `${number}%`;
  return (
    <View style={styles.scoreRow}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <View style={styles.scoreTrack}>
        <View style={[styles.scoreFill, { width }]} />
      </View>
      <Text style={styles.scoreValue}>{value.toFixed(1)}</Text>
    </View>
  );
}

function ScoreBlock({ title, score }: { title: string; score: JudgeScore | null }) {
  if (!score) {
    return null;
  }

  return (
    <View style={styles.scoreBlock}>
      <Text style={styles.scoreBlockTitle}>{`${title} - ${score.total.toFixed(1)}`}</Text>
      <ScoreRow label={t('gameScoreWit')} value={score.wit} />
      <ScoreRow label={t('gameScoreSpecificity')} value={score.specificity} />
      <ScoreRow label={t('gameScoreDelivery')} value={score.delivery} />
      <ScoreRow label={t('gameScoreCrowd')} value={score.crowdReaction} />
      <ScoreRow label={t('gameScoreComeback')} value={score.comebackPotential} />
    </View>
  );
}

function winnerText(winner: RoastRound['winner']): string {
  if (winner === 'user') {
    return t('gameRoundResultWinnerUser');
  }
  if (winner === 'artist') {
    return t('gameRoundResultWinnerArtist');
  }
  return t('gameRoundResultTie');
}

export function RoundResultPanel({ roundNumber, totalRounds, round, onNext, isFinalRound }: RoundResultPanelProps) {
  return (
    <View style={styles.card} testID="roast-duel-round-result-panel">
      <Text style={styles.title}>{`${t('gameRoundResultTitle')} ${roundNumber}/${totalRounds}`}</Text>
      <Text style={styles.winner}>{winnerText(round.winner)}</Text>

      <View style={styles.block}>
        <Text style={styles.blockTitle}>Toi</Text>
        <Text style={styles.blockText}>{round.userRoast}</Text>
      </View>
      <View style={styles.block}>
        <Text style={styles.blockTitle}>Cathy</Text>
        <Text style={styles.blockText}>{round.artistRoast}</Text>
      </View>

      <Text style={styles.verdictLabel}>{t('gameRoundResultJudgeVerdict')}</Text>
      <Text style={styles.verdictText}>{round.userScore?.verdict ?? round.artistScore?.verdict ?? '...'}</Text>

      <ScoreBlock title="Toi" score={round.userScore} />
      <ScoreBlock title="Cathy" score={round.artistScore} />

      <Pressable
        onPress={onNext}
        style={({ pressed }) => [styles.nextButton, pressed ? styles.nextButtonPressed : null]}
        accessibilityRole="button"
        testID="roast-duel-next-round"
      >
        <Text style={styles.nextButtonLabel}>{isFinalRound ? t('gameOverTitle') : t('gameRoundResultNextRound')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800'
  },
  winner: {
    color: theme.colors.neonBlue,
    fontSize: 14,
    fontWeight: '700'
  },
  block: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceSunken,
    padding: theme.spacing.sm,
    gap: 4
  },
  blockTitle: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  blockText: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 18
  },
  verdictLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  verdictText: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 18
  },
  scoreBlock: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceSunken,
    padding: theme.spacing.sm,
    gap: 6
  },
  scoreBlockTitle: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700'
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs
  },
  scoreLabel: {
    width: 92,
    color: theme.colors.textSecondary,
    fontSize: 11
  },
  scoreTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceButton,
    overflow: 'hidden'
  },
  scoreFill: {
    height: '100%',
    backgroundColor: theme.colors.neonBlue
  },
  scoreValue: {
    width: 32,
    textAlign: 'right',
    color: theme.colors.textPrimary,
    fontSize: 11,
    fontWeight: '700'
  },
  nextButton: {
    marginTop: theme.spacing.sm,
    minHeight: 42,
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlue,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceRaised
  },
  nextButtonPressed: {
    opacity: 0.94
  },
  nextButtonLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  }
});
