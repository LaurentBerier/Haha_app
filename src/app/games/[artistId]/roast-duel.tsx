import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BattlePanel } from '../../../components/games/BattlePanel';
import { GameOverPanel } from '../../../components/games/GameOverPanel';
import { LobbyPanel } from '../../../components/games/LobbyPanel';
import { RoundResultPanel } from '../../../components/games/RoundResultPanel';
import { BackButton } from '../../../components/common/BackButton';
import { useRoastDuel } from '../../../games/hooks/useRoastDuel';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { t } from '../../../i18n';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';

export default function RoastDuelScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';
  const navigation = useNavigation();
  const headerHorizontalInset = useHeaderHorizontalInset();
  const artists = useStore((state) => state.artists);
  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);
  const [roundCount, setRoundCount] = useState<3 | 5 | 7>(3);
  const [themeValue, setThemeValue] = useState('');

  const {
    game,
    currentRound,
    isUserTurn,
    isArtistStreaming,
    isJudging,
    isRoundResult,
    isGameOver,
    initGame,
    sendUserRoast,
    confirmNextRound,
    handleGameOver,
    abandon,
    clear
  } = useRoastDuel(artistId);

  useEffect(() => {
    if (isGameOver) {
      void handleGameOver();
    }
  }, [handleGameOver, isGameOver]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (!game) {
        return;
      }
      if (game.status === 'game-over' || game.status === 'abandoned') {
        return;
      }

      event.preventDefault();
      Alert.alert(t('gameAbandonConfirmTitle'), t('gameAbandonConfirmBody'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('gameBattleAbandon'),
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
      <View style={styles.center} testID="roast-duel-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  const status = game?.status ?? 'lobby';
  const effectiveRound = currentRound ?? null;
  const isLobbyLike = status === 'lobby' || status === 'coin-flip' || status === 'abandoned' || !game;
  const artistRoast =
    effectiveRound?.artistRoast || (isArtistStreaming || isJudging ? effectiveRound?.streamingContent ?? '' : '');

  return (
    <View style={styles.screen}>
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="roast-duel-back" />
      </View>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll} testID="roast-duel-screen">
        <Text style={styles.artistName}>{artist.name}</Text>

        {isLobbyLike ? (
          <LobbyPanel
            roundCount={roundCount}
            themeValue={themeValue}
            isCoinFlip={status === 'coin-flip'}
            firstRoaster={game?.firstRoaster ?? null}
            onRoundCountChange={setRoundCount}
            onThemeChange={setThemeValue}
            onStart={() => initGame({ roundCount, theme: themeValue.trim() || null })}
          />
        ) : null}

        {game && (isUserTurn || isArtistStreaming || isJudging) && effectiveRound ? (
          <BattlePanel
            currentRound={game.currentRound}
            totalRounds={game.config.roundCount}
            userScore={game.userTotalScore}
            artistScore={game.artistTotalScore}
            userRoast={effectiveRound.userRoast}
            artistRoast={artistRoast}
            isArtistStreaming={isArtistStreaming}
            isJudging={isJudging}
            errorMessage={game.error}
            onSend={(text) => void sendUserRoast(text)}
            onAbandon={abandon}
          />
        ) : null}

        {game && isRoundResult && effectiveRound ? (
          <RoundResultPanel
            roundNumber={game.currentRound}
            totalRounds={game.config.roundCount}
            round={effectiveRound}
            onNext={confirmNextRound}
            isFinalRound={game.currentRound >= game.config.roundCount}
          />
        ) : null}

        {isGameOver && game ? (
          <GameOverPanel
            game={game}
            onReplay={() => initGame({ roundCount: game.config.roundCount, theme: game.config.theme })}
            onExit={() => {
              clear();
              router.back();
            }}
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
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl * 2,
    gap: theme.spacing.sm
  },
  artistName: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '700'
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
