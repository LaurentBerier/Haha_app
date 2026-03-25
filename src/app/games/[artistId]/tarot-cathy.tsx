import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BackButton } from '../../../components/common/BackButton';
import { ScoreBar } from '../../../components/chat/ScoreBar';
import { GameResultPanel } from '../../../components/games/GameResultPanel';
import { TarotCard } from '../../../components/games/TarotCard';
import { useTarotCathy } from '../../../games/hooks/useTarotCathy';
import { TAROT_THEMES } from '../../../games/types';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { t } from '../../../i18n';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';
import type { TarotTheme } from '../../../games/types';

export default function TarotCathyScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';
  const navigation = useNavigation();
  const headerHorizontalInset = useHeaderHorizontalInset();
  const artists = useStore((state) => state.artists);
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
      <View style={styles.center} testID="tarot-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  const showStart = !game || game.status === 'abandoned';
  const isThemeSelect = game?.status === 'theme-select';
  const isCardSelect = game?.status === 'card-select';
  const isReading = game?.status === 'reading';

  const gameData = game?.gameData.type === 'tarot-cathy' ? game.gameData : null;
  const selectedCount = gameData?.selectedCardIndices.length ?? 0;
  const canConfirm = selectedCount === 3;
  const selectedTheme = gameData?.theme ?? null;

  return (
    <View style={styles.screen}>
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="tarot-back" />
      </View>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll} testID="tarot-screen">
        <Text style={styles.title}>{t('gameTarotTitle')}</Text>
        <Text style={styles.subtitle}>{artist.name}</Text>
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

        {/* Phase 1 — Démarrage */}
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

        {/* Phase 2 — Choix du thème */}
        {isThemeSelect ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{t('gameTarotChooseTheme')}</Text>
            <View style={styles.themeGrid}>
              {TAROT_THEMES.map((theme: TarotTheme) => (
                <Pressable
                  key={theme.id}
                  onPress={() => selectTheme(theme)}
                  style={({ pressed }) => [styles.themeButton, pressed ? styles.buttonPressed : null]}
                  accessibilityRole="button"
                  testID={`tarot-theme-${theme.id}`}
                >
                  <Text style={styles.themeEmoji}>{theme.emoji}</Text>
                  <Text style={styles.themeLabel}>{theme.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Phase 3 — Sélection des cartes */}
        {isCardSelect && gameData ? (
          <View style={styles.panel}>
            {selectedTheme ? (
              <View style={styles.selectedThemeRow}>
                <Text style={styles.selectedThemeEmoji}>{selectedTheme.emoji}</Text>
                <Text style={styles.selectedThemeLabel}>{selectedTheme.label}</Text>
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

        {/* Phase 4 — Chargement */}
        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={theme.colors.neonBlue} />
            <Text style={styles.loadingText}>{t('gameTarotLoading')}</Text>
          </View>
        ) : null}

        {/* Phase 5 — Révélation des cartes */}
        {isReading && readings.length > 0 ? (
          <View style={styles.panel}>
            {selectedTheme ? (
              <View style={styles.selectedThemeRow}>
                <Text style={styles.selectedThemeEmoji}>{selectedTheme.emoji}</Text>
                <Text style={styles.selectedThemeLabel}>{selectedTheme.label}</Text>
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

        {/* Phase 6 — Grand finale */}
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
              subtitle={selectedTheme ? `${selectedTheme.emoji} ${selectedTheme.label}` : '🔮'}
              replayLabel={t('gameTarotReplay')}
              exitLabel={t('gameExit')}
              onReplay={() => {
                clear();
                startGame();
              }}
              onExit={() => {
                clear();
                router.back();
              }}
              testID="tarot-result"
            />
          </>
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
  buttonPressed: {
    opacity: 0.85
  }
});
