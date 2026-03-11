import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { BackButton } from '../../components/common/BackButton';
import { useHeaderHorizontalInset } from '../../hooks/useHeaderHorizontalInset';
import { t } from '../../i18n';
import { SCORE_TITLE_TIERS } from '../../models/Gamification';
import { getUserTitle } from '../../services/scoreManager';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';

function getProgress(score: number): { current: string; next: string; ratio: number; nextThreshold: number } {
  const normalizedScore = Math.max(0, Math.floor(score));
  const fallbackTier = SCORE_TITLE_TIERS[0] ?? { min: 0, max: Number.POSITIVE_INFINITY, title: 'Spectateur gene' };
  const tierIndex = SCORE_TITLE_TIERS.findIndex((tier) => normalizedScore >= tier.min && normalizedScore <= tier.max);
  const currentIndex = tierIndex >= 0 ? tierIndex : SCORE_TITLE_TIERS.length - 1;
  const currentTier = SCORE_TITLE_TIERS[currentIndex] ?? fallbackTier;
  const nextTier = SCORE_TITLE_TIERS[currentIndex + 1] ?? currentTier;
  if (!nextTier || !Number.isFinite(nextTier.min)) {
    return {
      current: currentTier.title,
      next: currentTier.title,
      ratio: 1,
      nextThreshold: normalizedScore
    };
  }

  const span = Math.max(1, nextTier.min - currentTier.min);
  const progress = Math.min(1, Math.max(0, (normalizedScore - currentTier.min) / span));
  return {
    current: currentTier.title,
    next: nextTier.title,
    ratio: progress,
    nextThreshold: nextTier.min
  };
}

export default function StatsScreen() {
  const headerHorizontalInset = useHeaderHorizontalInset();
  const {
    score,
    roastsGenerated,
    punchlinesCreated,
    destructions,
    photosRoasted,
    memesGenerated,
    battleWins,
    dailyStreak
  } = useStore((state) => ({
    score: state.score,
    roastsGenerated: state.roastsGenerated,
    punchlinesCreated: state.punchlinesCreated,
    destructions: state.destructions,
    photosRoasted: state.photosRoasted,
    memesGenerated: state.memesGenerated,
    battleWins: state.battleWins,
    dailyStreak: state.dailyStreak
  }));

  const title = getUserTitle(score);
  const progress = useMemo(() => getProgress(score), [score]);

  return (
    <View style={styles.root}>
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="stats-back" />
      </View>
      <ScrollView contentContainerStyle={styles.screen} testID="stats-screen">

      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{t('statsGlobalScore')}</Text>
        <Text style={styles.heroScore}>{`🔥 ${score}`}</Text>
        <Text style={styles.heroSubtitle}>{title}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.row}>{`🔥 ${t('statsRoastsGenerated')} ${roastsGenerated}`}</Text>
        <Text style={styles.row}>{`🎤 ${t('statsPunchlinesCreated')} ${punchlinesCreated}`}</Text>
        <Text style={styles.row}>{`💀 ${t('statsDestructions')} ${destructions}`}</Text>
        <Text style={styles.row}>{`📸 ${t('statsPhotosRoasted')} ${photosRoasted}`}</Text>
        <Text style={styles.row}>{`😂 ${t('statsMemesGenerated')} ${memesGenerated}`}</Text>
        <Text style={styles.row}>{`⚔️ ${t('statsBattleWins')} ${battleWins}`}</Text>
        <Text style={styles.row}>{`📅 ${t('statsDailyStreak')} ${dailyStreak}`}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.progressTitle}>{t('statsProgression')}</Text>
        <Text style={styles.progressLabel}>{`${progress.current} → ${progress.next}`}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress.ratio * 100)}%` }]} />
        </View>
        <Text style={styles.progressScore}>{`${score} / ${progress.nextThreshold}`}</Text>
      </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  screen: {
    minHeight: '100%',
    width: '100%',
    maxWidth: 656,
    alignSelf: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    gap: theme.spacing.md
  },
  topRow: {
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs
  },
  hero: {
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    alignItems: 'center',
    gap: theme.spacing.xs
  },
  heroTitle: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  heroScore: {
    color: theme.colors.neonBlue,
    fontSize: 34,
    fontWeight: '800'
  },
  heroSubtitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
  },
  card: {
    borderWidth: 1.4,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.xs
  },
  row: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  },
  progressTitle: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  progressLabel: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600'
  },
  progressTrack: {
    width: '100%',
    height: 10,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceSunken,
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: theme.colors.neonBlue
  },
  progressScore: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600'
  }
});
