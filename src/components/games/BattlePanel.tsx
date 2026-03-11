import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../../i18n';
import { theme } from '../../theme';

interface BattlePanelProps {
  currentRound: number;
  totalRounds: number;
  userScore: number;
  artistScore: number;
  userRoast: string;
  artistRoast: string;
  isArtistStreaming: boolean;
  isJudging: boolean;
  errorMessage: string | null;
  onSend: (text: string) => void;
  onAbandon: () => void;
}

export function BattlePanel({
  currentRound,
  totalRounds,
  userScore,
  artistScore,
  userRoast,
  artistRoast,
  isArtistStreaming,
  isJudging,
  errorMessage,
  onSend,
  onAbandon
}: BattlePanelProps) {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (isArtistStreaming || isJudging) {
      setDraft('');
    }
  }, [isArtistStreaming, isJudging]);

  const isInputDisabled = isArtistStreaming || isJudging;

  return (
    <View style={styles.card} testID="roast-duel-battle-panel">
      <Text style={styles.roundLabel}>{`${t('gameBattleRoundLabel')} ${currentRound}/${totalRounds}`}</Text>
      <Text style={styles.scoreLabel}>{`${t('gameBattleScoreLabel')} ${userScore} - ${artistScore}`}</Text>

      {userRoast ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Toi</Text>
          <Text style={styles.blockText}>{userRoast}</Text>
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={styles.blockTitle}>Cathy</Text>
        <Text style={styles.blockText}>
          {artistRoast || (isArtistStreaming ? t('gameBattleArtistThinking') : '...')}
        </Text>
      </View>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          editable={!isInputDisabled}
          style={styles.input}
          placeholder={t('gameBattleInputPlaceholder')}
          placeholderTextColor={theme.colors.textDisabled}
          testID="roast-duel-input"
        />
        <Pressable
          onPress={() => onSend(draft)}
          disabled={!draft.trim() || isInputDisabled}
          style={({ pressed }) => [
            styles.sendButton,
            (!draft.trim() || isInputDisabled) ? styles.sendButtonDisabled : null,
            pressed ? styles.sendButtonPressed : null
          ]}
          accessibilityRole="button"
          testID="roast-duel-send"
        >
          <Text style={styles.sendLabel}>{t('send')}</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={onAbandon}
        style={({ pressed }) => [styles.abandonButton, pressed ? styles.abandonPressed : null]}
        accessibilityRole="button"
        testID="roast-duel-abandon"
      >
        <Text style={styles.abandonLabel}>{t('gameBattleAbandon')}</Text>
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
  roundLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  scoreLabel: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800'
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
    fontSize: 14,
    lineHeight: 18
  },
  error: {
    color: theme.colors.error,
    fontSize: 13,
    fontWeight: '600'
  },
  composer: {
    gap: theme.spacing.xs
  },
  input: {
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceSunken,
    color: theme.colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm
  },
  sendButton: {
    minHeight: 42,
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlue,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceRaised
  },
  sendButtonDisabled: {
    opacity: 0.45
  },
  sendButtonPressed: {
    opacity: 0.94
  },
  sendLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  },
  abandonButton: {
    marginTop: theme.spacing.xs,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: theme.colors.error,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6
  },
  abandonPressed: {
    opacity: 0.92
  },
  abandonLabel: {
    color: theme.colors.error,
    fontSize: 12,
    fontWeight: '700'
  }
});
