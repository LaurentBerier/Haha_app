import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from 'react-native';
import { ChatInput } from '../../../components/chat/ChatInput';
import { MessageList } from '../../../components/chat/MessageList';
import { BackButton } from '../../../components/common/BackButton';
import { ScoreBar } from '../../../components/chat/ScoreBar';
import { GameResultPanel } from '../../../components/games/GameResultPanel';
import { VraiInventeCard } from '../../../components/games/VraiInventeCard';
import { useGameCompanionChat } from '../../../games/hooks/useGameCompanionChat';
import { useVraiOuInvente } from '../../../games/hooks/useVraiOuInvente';
import { useGameExitGuard } from '../../../hooks/useGameExitGuard';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { useVoiceConversation } from '../../../hooks/useVoiceConversation';
import { t } from '../../../i18n';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';
import { resolveGameChatWindowLayout } from '../../../utils/gameChatLayout';

function formatUserDisplayName(displayName: string | null, email: string | null): string {
  const trimmed = displayName?.trim();
  if (trimmed) {
    return trimmed;
  }

  const emailPrefix = (email ?? '').split('@')[0]?.trim();
  return emailPrefix || t('chatUserFallbackName');
}

function formatArtistDisplayName(artistName: string | null): string {
  if (!artistName) {
    return t('chatDefaultArtistName');
  }

  if (artistName === 'Cathy Gauthier') {
    return t('chatDefaultArtistName');
  }

  return artistName;
}

export default function VraiOuInventeScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';
  const navigation = useNavigation();
  const headerHorizontalInset = useHeaderHorizontalInset();
  const { height: viewportHeight } = useWindowDimensions();
  const rootLayoutRef = useRef<View | null>(null);
  const protectedContentRef = useRef<View | null>(null);
  const [protectedAreaBottomY, setProtectedAreaBottomY] = useState<number | null>(null);
  const [hasTypedDraft, setHasTypedDraft] = useState(false);

  const artists = useStore((state) => state.artists);
  const language = useStore((state) => state.language);
  const sessionUser = useStore((state) => state.session?.user ?? null);
  const conversationModeEnabled = useStore((state) => state.conversationModeEnabled);
  const setConversationModeEnabled = useStore((state) => state.setConversationModeEnabled);
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

  const showCompanion = Boolean(game && game.status !== 'abandoned');

  const {
    conversationId: companionConversationId,
    messages: companionMessages,
    isGreetingBooting,
    isStreaming: isCompanionStreaming,
    tailFollowSignal: companionTailFollowSignal,
    sendFromComposer,
    clear: clearCompanionChat
  } = useGameCompanionChat({
    artistId,
    artistName: artist?.name ?? null,
    gameId: game?.id ?? null,
    gameType: 'vrai-ou-invente',
    gameLabel: t('gameVraiInventeTitle'),
    enabled: showCompanion
  });

  const isCompanionComposerDisabled = !showCompanion || isLoading || isGreetingBooting || isCompanionStreaming;

  const {
    isListening,
    transcript,
    error: conversationError,
    status: conversationStatus,
    hint: conversationHint,
    pauseListening,
    resumeListening
  } = useVoiceConversation({
    enabled: showCompanion && conversationModeEnabled && !isCompanionComposerDisabled,
    disabled: isCompanionComposerDisabled,
    hasTypedDraft,
    isPlaying: false,
    onSend: (text) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }
      sendFromComposer({ text: normalized });
    },
    onStopAudio: () => {},
    language,
    fallbackLanguage: language
  });

  const composerOffset = Platform.select({ ios: 108, default: 96 }) ?? 96;
  const { conversationOverlayTop, chatWindowMaxHeight, screenPaddingBottom } = useMemo(
    () =>
      resolveGameChatWindowLayout({
        viewportHeight,
        composerOffset,
        protectedAreaBottomY,
        fallbackTopRatio: 0.52,
        minOverlayTopRatio: 0.24,
        maxOverlayTopRatio: 0.84,
        minChatWindowHeight: 170
      }),
    [composerOffset, protectedAreaBottomY, viewportHeight]
  );

  const measureProtectedAreaBottom = useCallback(() => {
    const rootNode = rootLayoutRef.current;
    const protectedNode = protectedContentRef.current;
    if (!rootNode || !protectedNode) {
      return;
    }

    rootNode.measureInWindow((_rootX, rootY) => {
      protectedNode.measureInWindow((_panelX, panelY, _panelWidth, panelHeight) => {
        if (!Number.isFinite(panelHeight) || panelHeight <= 0) {
          return;
        }

        const relativeBottom = Math.max(0, panelY - rootY + panelHeight);
        setProtectedAreaBottomY((previous) => {
          if (typeof previous === 'number' && Math.abs(previous - relativeBottom) < 1) {
            return previous;
          }
          return relativeBottom;
        });
      });
    });
  }, []);

  useEffect(() => {
    measureProtectedAreaBottom();
  }, [
    currentIndex,
    currentQuestion?.explanation,
    game?.status,
    isComplete,
    isLoading,
    isRevealed,
    measureProtectedAreaBottom,
    score,
    showCompanion
  ]);

  const navigateBackOrGamesHome = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(`/games/${artistId}`);
  }, [artistId]);

  const { runProtectedNavigation } = useGameExitGuard({
    navigation,
    gameStatus: game?.status ?? null,
    title: t('gameAbandon'),
    message: t('gameAbandonConfirmBody'),
    confirmLabel: t('gameAbandon'),
    cancelLabel: t('cancel'),
    onAbandon: abandon
  });

  if (!artist) {
    return (
      <View style={styles.center} testID="vrai-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  const userDisplayName = formatUserDisplayName(sessionUser?.displayName ?? null, sessionUser?.email ?? null);
  const artistDisplayName = formatArtistDisplayName(artist.name ?? null);
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

  const vraiScreenPaddingBottom = showCompanion ? screenPaddingBottom : theme.spacing.xl * 2;

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.screen}
      keyboardVerticalOffset={88}
    >
      <View style={styles.screen} ref={rootLayoutRef} onLayout={measureProtectedAreaBottom}>
        <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}> 
          <BackButton
            testID="vrai-back"
            onPress={() => {
              runProtectedNavigation(navigateBackOrGamesHome);
            }}
          />
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: vraiScreenPaddingBottom }]}
          style={styles.scroll}
          testID="vrai-screen"
        >
          <View ref={protectedContentRef} onLayout={measureProtectedAreaBottom}>
            <Text style={styles.title}>{t('gameVraiInventeTitle')}</Text>
            <Text style={styles.subtitle}>{t('gameVraiInventeDescription')}</Text>
            <ScoreBar />

            {game?.error ? <Text style={styles.gameError}>{game.error}</Text> : null}

            {showStart ? (
              <Pressable
                onPress={() => void startGame()}
                style={({ pressed }) => [styles.startButton, pressed ? styles.buttonPressed : null]}
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
                      style={({ pressed }) => [styles.nextButton, pressed ? styles.buttonPressed : null]}
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
                onReplay={() => {
                  clearCompanionChat();
                  void startGame();
                }}
                onExit={() => {
                  clear();
                  clearCompanionChat();
                  navigateBackOrGamesHome();
                }}
                testID="vrai-result"
              />
            ) : null}
          </View>
        </ScrollView>

        {showCompanion ? (
          <View
            pointerEvents="box-none"
            style={[styles.companionOverlay, { top: conversationOverlayTop, bottom: composerOffset }]}
          >
            <View style={[styles.companionWindow, { maxHeight: chatWindowMaxHeight }]}> 
              {isGreetingBooting ? <Text style={styles.companionBooting}>{t('gameCompanionGreetingBooting')}</Text> : null}
              <MessageList
                testID="vrai-companion-message-list"
                listKey={companionConversationId}
                listStyle={styles.companionList}
                contentContainerStyle={styles.companionListContent}
                messages={companionMessages}
                userDisplayName={userDisplayName}
                artistDisplayName={artistDisplayName}
                showEmptyState={false}
                forceFollowSignal={companionTailFollowSignal}
                windowSize={20}
                initialNumToRender={24}
                maxToRenderPerBatch={24}
              />
              {isCompanionStreaming ? <Text style={styles.companionStatus}>{t('gameCompanionThinking')}</Text> : null}
            </View>
          </View>
        ) : null}

        {showCompanion ? (
          <View style={styles.composerDock} testID="vrai-game-composer">
            <View style={styles.composerContent}>
              <ChatInput
                onSend={sendFromComposer}
                allowImage={false}
                disabled={isCompanionComposerDisabled}
                conversationMode={{
                  enabled: conversationModeEnabled,
                  isListening,
                  transcript,
                  error: conversationError,
                  micState: conversationStatus,
                  hint: conversationHint,
                  onToggle: () => {
                    setConversationModeEnabled(true);
                  },
                  onPauseListening: () => {
                    setConversationModeEnabled(false);
                    pauseListening();
                  },
                  onResumeListening: resumeListening,
                  onTypingStateChange: setHasTypedDraft
                }}
              />
            </View>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
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
  },
  gameError: {
    color: theme.colors.error,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center'
  },
  companionOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: theme.spacing.md,
    overflow: 'hidden'
  },
  companionWindow: {
    width: '100%',
    maxWidth: 784,
    minHeight: 90,
    justifyContent: 'flex-end'
  },
  companionBooting: {
    alignSelf: 'flex-start',
    marginLeft: theme.spacing.md,
    marginBottom: 4,
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700'
  },
  companionList: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto'
  },
  companionListContent: {
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.sm
  },
  companionStatus: {
    alignSelf: 'flex-start',
    marginLeft: theme.spacing.md,
    marginTop: 4,
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700'
  },
  composerDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    paddingBottom: Platform.OS === 'ios' ? theme.spacing.sm : theme.spacing.xs
  },
  composerContent: {
    width: '100%',
    maxWidth: 784,
    alignSelf: 'center'
  }
});
