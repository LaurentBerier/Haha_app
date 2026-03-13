import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BackButton } from '../../../components/common/BackButton';
import { ScoreBar } from '../../../components/chat/ScoreBar';
import { GameResultPanel } from '../../../components/games/GameResultPanel';
import { VraiInventeCard } from '../../../components/games/VraiInventeCard';
import { useVraiOuInvente } from '../../../games/hooks/useVraiOuInvente';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { t } from '../../../i18n';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';

export default function VraiOuInventeScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';
  const navigation = useNavigation();
  const headerHorizontalInset = useHeaderHorizontalInset();
  const artists = useStore((state) => state.artists);
  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);

  const {
    game,
    currentQuestion,
    currentIndex,
    totalQuestions,
    score,
    isLoading,
    isRevealed,
    isComplete,
    startGame,
    submitAnswer,
    nextQuestion,
    abandon,
    clear
  } = useVraiOuInvente(artistId);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (!game) {
        return;
      }
      if (game.status === 'complete' || game.status === 'abandoned') {
        return;
      }

      event.preventDefault();
      Alert.alert(t('gameAbandon'), t('gameAbandonConfirmBody'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('gameAbandon'),
          style: 'destructive',
          onPress: () => {
            abandon();
            navigation.dispatch(event.data.action);
          }
        }
      ]);
    });

    return unsubscribe;
  }, [abandon, game, navigation]);

  if (!artist) {
    return (
      <View style={styles.center} testID="vrai-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  const showStart = !game || game.status === 'abandoned';
  const scoreLine = `${t('gameVraiInventeScore')} ${score}/${totalQuestions}`;
  const roundLine = `${t('gameVraiInventeRound')} ${Math.min(currentIndex + 1, totalQuestions)}/${totalQuestions}`;
  const revealMessage = currentQuestion?.isCorrect ? t('gameVraiInventeCorrect') : t('gameVraiInventeWrong');

  const resultSubtitle =
    score === totalQuestions
      ? t('gameVraiInventeWinPerfect')
      : score >= Math.ceil(totalQuestions / 2)
        ? t('gameVraiInventeWinGood')
        : t('gameVraiInventeWinMeh');

  return (
    <View style={styles.screen}>
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="vrai-back" />
      </View>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll} testID="vrai-screen">
        <Text style={styles.title}>{t('gameVraiInventeTitle')}</Text>
        <Text style={styles.subtitle}>{artist.name}</Text>
        <ScoreBar />

        {showStart ? (
          <Pressable
            onPress={() => void startGame()}
            style={({ hovered, pressed }) => [styles.startButton, hovered ? styles.buttonHover : null, pressed ? styles.buttonPressed : null]}
            accessibilityRole="button"
            testID="vrai-start"
          >
            <Text style={styles.startLabel}>{t('gameLobbyGoButton')}</Text>
          </Pressable>
        ) : null}

        {game && !isComplete ? (
          <View style={styles.panel}>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>{roundLine}</Text>
              <Text style={styles.metaText}>{scoreLine}</Text>
            </View>

            {isLoading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={theme.colors.neonBlue} />
                <Text style={styles.loadingText}>{t('gameVraiInventeLoading')}</Text>
              </View>
            ) : currentQuestion ? (
              <View style={styles.options}>
                {currentQuestion.statements.map((statement, index) => (
                  <VraiInventeCard
                    key={`vrai-option-${currentIndex}-${index}`}
                    index={index}
                    text={statement.text}
                    isRevealed={isRevealed}
                    isSelected={currentQuestion.userAnswerIndex === index}
                    isTrue={statement.isTrue}
                    disabled={isRevealed}
                    onPress={submitAnswer}
                  />
                ))}
              </View>
            ) : null}

            {isRevealed && currentQuestion ? (
              <View style={styles.revealPanel}>
                <Text style={styles.revealTitle}>{revealMessage}</Text>
                <Text style={styles.explainLabel}>{t('gameVraiInventeExplanation')}</Text>
                <Text style={styles.explainText}>{currentQuestion.explanation}</Text>

                <Pressable
                  onPress={() => void nextQuestion()}
                  style={({ hovered, pressed }) => [styles.nextButton, hovered ? styles.buttonHover : null, pressed ? styles.buttonPressed : null]}
                  accessibilityRole="button"
                  testID="vrai-next"
                >
                  <Text style={styles.nextLabel}>{t('gameVraiInventeNext')}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {isComplete ? (
          <GameResultPanel
            title={t('gameVraiInventeTitle')}
            subtitle={resultSubtitle}
            scoreLabel={scoreLine}
            replayLabel={t('gameVraiInventeReplay')}
            exitLabel={t('gameExit')}
            onReplay={() => void startGame()}
            onExit={() => {
              clear();
              router.back();
            }}
            testID="vrai-result"
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  topRow: {
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs
  },
  scroll: {
    flex: 1
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl * 2,
    gap: theme.spacing.sm
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 23,
    fontWeight: '800'
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '700'
  },
  panel: {
    borderWidth: 1.3,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    gap: theme.spacing.sm
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.sm
  },
  metaText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700'
  },
  loadingBox: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm
  },
  loadingText: {
    color: theme.colors.textSecondary,
    fontSize: 13
  },
  options: {
    gap: theme.spacing.xs
  },
  revealPanel: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.sm,
    gap: theme.spacing.xs
  },
  revealTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800'
  },
  explainLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  explainText: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 18
  },
  startButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  startLabel: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700'
  },
  nextButton: {
    marginTop: theme.spacing.xs,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1.4,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  nextLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  },
  buttonHover: {
    borderColor: theme.colors.neonBlue
  },
  buttonPressed: {
    opacity: 0.95
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  errorText: {
    color: theme.colors.error
  }
});
