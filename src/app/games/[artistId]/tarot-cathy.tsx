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
import { TarotCard } from '../../../components/games/TarotCard';
import { useGameCompanionChat } from '../../../games/hooks/useGameCompanionChat';
import { useTarotCathy } from '../../../games/hooks/useTarotCathy';
import { getTarotThemeLabelKey, TAROT_THEMES } from '../../../games/types';
import { useGameExitGuard } from '../../../hooks/useGameExitGuard';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { useVoiceConversation } from '../../../hooks/useVoiceConversation';
import { t } from '../../../i18n';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';
import { resolveGameChatWindowLayout } from '../../../utils/gameChatLayout';
import type { TarotTheme } from '../../../games/types';

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

export default function TarotCathyScreen() {
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
    readings,
    grandFinale,
    isLoading,
    isComplete,
    allFlipped,
    startGame,
    selectTheme,
    toggleCardSelection,
    confirmCardSelection,
    flipCard,
    completeReading,
    abandon,
    clear
  } = useTarotCathy(artistId);

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
    gameType: 'tarot-cathy',
    gameLabel: t('gameTarotTitle'),
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
    allFlipped,
    game?.status,
    isComplete,
    isLoading,
    measureProtectedAreaBottom,
    readings.length,
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
      <View style={styles.center} testID="tarot-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  const userDisplayName = formatUserDisplayName(sessionUser?.displayName ?? null, sessionUser?.email ?? null);
  const artistDisplayName = formatArtistDisplayName(artist.name ?? null);
  const showStart = !game || game.status === 'abandoned';
  const isThemeSelect = game?.status === 'theme-select';
  const isCardSelect = game?.status === 'card-select';
  const isReading = game?.status === 'reading';

  const gameData = game?.gameData.type === 'tarot-cathy' ? game.gameData : null;
  const selectedCount = gameData?.selectedCardIndices.length ?? 0;
  const canConfirm = selectedCount === 3;
  const selectedTheme = gameData?.theme ?? null;
  const selectedThemeLabel = selectedTheme ? t(getTarotThemeLabelKey(selectedTheme.id)) : null;
  const tarotScreenPaddingBottom = showCompanion ? screenPaddingBottom : theme.spacing.xl * 2;

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.screen}
      keyboardVerticalOffset={88}
    >
      <View style={styles.screen} ref={rootLayoutRef} onLayout={measureProtectedAreaBottom}>
        <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}> 
          <BackButton
            testID="tarot-back"
            onPress={() => {
              runProtectedNavigation(navigateBackOrGamesHome);
            }}
          />
        </View>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: tarotScreenPaddingBottom }]}
          style={styles.scroll}
          testID="tarot-screen"
        >
          <View ref={protectedContentRef} onLayout={measureProtectedAreaBottom}>
            <Text style={styles.title}>{t('gameTarotTitle')}</Text>
            <Text style={styles.subtitle}>{t('gameTarotDescription')}</Text>
            <ScoreBar />

            {game?.error ? (
              <View style={styles.errorBox}>
                <Text style={styles.gameError}>{game.error}</Text>
                <Pressable
                  onPress={startGame}
                  style={({ pressed }) => [styles.retryButton, pressed ? styles.buttonPressed : null]}
                  accessibilityRole="button"
                >
                  <Text style={styles.retryLabel}>{t('gameErrorRetry')}</Text>
                </Pressable>
              </View>
            ) : null}

            {showStart ? (
              <Pressable
                onPress={startGame}
                style={({ pressed }) => [styles.startButton, pressed ? styles.buttonPressed : null]}
                accessibilityRole="button"
                testID="tarot-start"
              >
                <Text style={styles.startEmoji}>🔮</Text>
                <Text style={styles.startLabel}>{t('gameTarotTitle')}</Text>
                <Text style={styles.startSub}>{t('gameTarotDescription')}</Text>
              </Pressable>
            ) : null}

            {isThemeSelect ? (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>{t('gameTarotChooseTheme')}</Text>
                <View style={styles.themeGrid}>
                  {TAROT_THEMES.map((theme: TarotTheme) => (
                    <Pressable
                      key={theme.id}
                      onPress={() =>
                        selectTheme({
                          ...theme,
                          label: t(getTarotThemeLabelKey(theme.id))
                        })
                      }
                      style={({ pressed }) => [styles.themeButton, pressed ? styles.buttonPressed : null]}
                      accessibilityRole="button"
                      testID={`tarot-theme-${theme.id}`}
                    >
                      <Text style={styles.themeEmoji}>{theme.emoji}</Text>
                      <Text style={styles.themeLabel}>{t(getTarotThemeLabelKey(theme.id))}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {isCardSelect && gameData ? (
              <View style={styles.panel}>
                {selectedTheme ? (
                  <View style={styles.selectedThemeRow}>
                    <Text style={styles.selectedThemeEmoji}>{selectedTheme.emoji}</Text>
                    <Text style={styles.selectedThemeLabel}>{selectedThemeLabel}</Text>
                  </View>
                ) : null}
                <Text style={styles.panelTitle}>{t('gameTarotChooseCards')}</Text>
                <Text style={styles.cardCountText}>
                  {t('gameTarotCardCount').replace('{{count}}', String(selectedCount))}
                </Text>
                <View style={styles.cardPool}>
                  {gameData.cardPool.map((_, index) => (
                    <TarotCard
                      key={`pool-${index}`}
                      index={index}
                      cardName=""
                      emoji=""
                      interpretation=""
                      isFlipped={false}
                      isSelected={gameData.selectedCardIndices.includes(index)}
                      mode="selection"
                      disabled={!gameData.selectedCardIndices.includes(index) && selectedCount >= 3}
                      onPress={toggleCardSelection}
                    />
                  ))}
                </View>
                <Pressable
                  onPress={() => canConfirm && void confirmCardSelection()}
                  disabled={!canConfirm}
                  style={({ pressed }) => [
                    styles.confirmButton,
                    !canConfirm && styles.confirmButtonDisabled,
                    pressed && canConfirm ? styles.buttonPressed : null
                  ]}
                  accessibilityRole="button"
                  testID="tarot-confirm"
                >
                  <Text style={[styles.confirmLabel, !canConfirm && styles.confirmLabelDisabled]}>
                    {t('gameTarotConfirm')}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {isLoading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="small" color={theme.colors.neonBlue} />
                <Text style={styles.loadingText}>{t('gameTarotLoading')}</Text>
              </View>
            ) : null}

            {isReading && readings.length > 0 ? (
              <View style={styles.panel}>
                {selectedTheme ? (
                  <View style={styles.selectedThemeRow}>
                    <Text style={styles.selectedThemeEmoji}>{selectedTheme.emoji}</Text>
                    <Text style={styles.selectedThemeLabel}>{selectedThemeLabel}</Text>
                  </View>
                ) : null}
                <View style={styles.revealList}>
                  {readings.map((reading, index) => (
                    <TarotCard
                      key={`reveal-${index}-${reading.cardName}`}
                      index={index}
                      cardName={reading.cardName}
                      emoji={reading.emoji}
                      interpretation={reading.interpretation}
                      isFlipped={reading.isFlipped}
                      mode="reveal"
                      disabled={false}
                      onPress={flipCard}
                    />
                  ))}
                </View>
                {allFlipped ? (
                  <Pressable
                    onPress={completeReading}
                    style={({ pressed }) => [styles.confirmButton, pressed ? styles.buttonPressed : null]}
                    accessibilityRole="button"
                    testID="tarot-see-verdict"
                  >
                    <Text style={styles.confirmLabel}>{t('gameTarotSeeVerdict')}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {isComplete ? (
              <>
                {grandFinale ? (
                  <View style={styles.finalePanel}>
                    <Text style={styles.finaleLabel}>{t('gameTarotGrandFinale')}</Text>
                    <Text style={styles.finaleText}>{grandFinale}</Text>
                  </View>
                ) : null}
                <GameResultPanel
                  title={t('gameTarotAllRevealed')}
                  subtitle={selectedTheme && selectedThemeLabel ? `${selectedTheme.emoji} ${selectedThemeLabel}` : '🔮'}
                  replayLabel={t('gameTarotReplay')}
                  exitLabel={t('gameExit')}
                  onReplay={() => {
                    clear();
                    clearCompanionChat();
                    startGame();
                  }}
                  onExit={() => {
                    clear();
                    clearCompanionChat();
                    navigateBackOrGamesHome();
                  }}
                  testID="tarot-result"
                />
              </>
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
                testID="tarot-companion-message-list"
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
          <View style={styles.composerDock} testID="tarot-game-composer">
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background
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
  errorText: {
    color: theme.colors.error,
    fontSize: 14
  },
  errorBox: {
    gap: theme.spacing.xs
  },
  gameError: {
    color: theme.colors.error,
    fontSize: 13
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: 8,
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface
  },
  retryLabel: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700'
  },
  startButton: {
    borderWidth: 1.4,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.sm
  },
  startEmoji: {
    fontSize: 40,
    marginBottom: 4
  },
  startLabel: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800'
  },
  startSub: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    textAlign: 'center'
  },
  panel: {
    borderWidth: 1.3,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm
  },
  panelTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm
  },
  themeButton: {
    flex: 1,
    minWidth: '45%',
    borderWidth: 1.4,
    borderColor: theme.colors.border,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceRaised,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    alignItems: 'center',
    gap: 4
  },
  themeEmoji: {
    fontSize: 28
  },
  themeLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center'
  },
  selectedThemeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs
  },
  selectedThemeEmoji: {
    fontSize: 16
  },
  selectedThemeLabel: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700'
  },
  cardCountText: {
    color: theme.colors.textSecondary,
    fontSize: 13
  },
  cardPool: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.sm
  },
  confirmButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  confirmButtonDisabled: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    opacity: 0.5
  },
  confirmLabel: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700'
  },
  confirmLabelDisabled: {
    color: theme.colors.textSecondary
  },
  loadingBox: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm
  },
  loadingText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    textAlign: 'center'
  },
  revealList: {
    gap: theme.spacing.sm
  },
  finalePanel: {
    borderWidth: 1.4,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.xs
  },
  finaleLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  finaleText: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600'
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
  },
  buttonPressed: {
    opacity: 0.85
  }
});
