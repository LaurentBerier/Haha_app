import { useCallback, useEffect, useMemo, useRef } from 'react';
import { t } from '../../i18n';
import { useStore } from '../../store/useStore';
import { collectArtistMemoryFacts } from '../../utils/memoryFacts';
import { useGameTts } from './useGameTts';
import { TarotService } from '../services/TarotService';
import type { Game, TarotCathyData, TarotReading, TarotTheme } from '../types';

interface UseTarotCathyResult {
  game: Game | null;
  readings: TarotReading[];
  grandFinale: string | null;
  isLoading: boolean;
  isComplete: boolean;
  allFlipped: boolean;
  startGame: () => void;
  selectTheme: (theme: TarotTheme) => void;
  toggleCardSelection: (cardIndex: number) => void;
  confirmCardSelection: () => Promise<void>;
  flipCard: (index: number) => void;
  completeReading: () => void;
  abandon: () => void;
  clear: () => void;
}

type TarotGame = Game & {
  gameType: 'tarot-cathy';
  gameData: TarotCathyData;
};

function isTarotGame(game: Game | null, artistId: string): game is TarotGame {
  return Boolean(
    game &&
      game.artistId === artistId &&
      game.gameType === 'tarot-cathy' &&
      game.gameData.type === 'tarot-cathy'
  );
}

export function useTarotCathy(artistId: string): UseTarotCathyResult {
  const activeGame = useStore((state) => state.activeGame);
  const startTarotGame = useStore((state) => state.startTarotGame);
  const selectTarotTheme = useStore((state) => state.selectTarotTheme);
  const toggleTarotCardSelection = useStore((state) => state.toggleTarotCardSelection);
  const confirmTarotCardSelection = useStore((state) => state.confirmTarotCardSelection);
  const receiveTarotReadings = useStore((state) => state.receiveTarotReadings);
  const flipTarotCard = useStore((state) => state.flipTarotCard);
  const completeTarotReading = useStore((state) => state.completeTarotReading);
  const setGameError = useStore((state) => state.setGameError);
  const abandonGame = useStore((state) => state.abandonGame);
  const clearGame = useStore((state) => state.clearGame);
  const incrementUsage = useStore((state) => state.incrementUsage);
  const language = useStore((state) => state.language);
  const { speak, stop } = useGameTts({
    artistId,
    language,
    contextTag: 'tarot-cathy'
  });

  const requestInFlightRef = useRef(false);

  const game = useMemo(() => {
    if (!isTarotGame(activeGame, artistId)) {
      return null;
    }
    return activeGame;
  }, [activeGame, artistId]);

  const readings = game && game.gameData.type === 'tarot-cathy' ? game.gameData.readings : [];
  const grandFinale = game && game.gameData.type === 'tarot-cathy' ? game.gameData.grandFinale : null;
  const isLoading = Boolean(game && game.status === 'loading');
  const isComplete = game?.status === 'complete';
  const allFlipped = readings.length === 3 && readings.every((r) => r.isFlipped);

  const startGame = useCallback(() => {
    void stop();
    startTarotGame(artistId);
    setGameError(null);
  }, [artistId, setGameError, startTarotGame, stop]);

  const selectTheme = useCallback(
    (theme: TarotTheme) => {
      selectTarotTheme(theme);
    },
    [selectTarotTheme]
  );

  const toggleCardSelection = useCallback(
    (cardIndex: number) => {
      toggleTarotCardSelection(cardIndex);
    },
    [toggleTarotCardSelection]
  );

  const fetchReadings = useCallback(
    async (gameId: string) => {
      if (requestInFlightRef.current) {
        return;
      }
      requestInFlightRef.current = true;

      try {
        const latestState = useStore.getState();
        const latestGame = latestState.activeGame;

        if (!isTarotGame(latestGame, artistId) || latestGame.id !== gameId) {
          return;
        }

        const { cardPool, selectedCardIndices, theme } = latestGame.gameData;
        const selectedCards = selectedCardIndices
          .map((i) => cardPool[i])
          .filter((c): c is NonNullable<typeof c> => c !== undefined);

        if (selectedCards.length !== 3) {
          setGameError(t('gameErrorGeneric'));
          return;
        }

        const userProfile = latestState.userProfile ?? null;
        const activeConversationId = latestState.activeConversationId ?? '';
        const memoryFacts = collectArtistMemoryFacts(latestState, artistId, activeConversationId);

        const result = await TarotService.fetchReading({
          artistId,
          language: 'fr-CA',
          theme,
          cards: selectedCards,
          userProfile,
          memoryFacts
        });

        const refreshed = useStore.getState().activeGame;
        if (!refreshed || refreshed.id !== gameId || refreshed.status === 'abandoned') {
          return;
        }

        receiveTarotReadings(result.readings, result.grandFinale);
        incrementUsage();
      } catch (error) {
        console.error('[useTarotCathy] Reading fetch failed', error);
        setGameError(t('gameErrorGeneric'));
      } finally {
        requestInFlightRef.current = false;
      }
    },
    [artistId, incrementUsage, receiveTarotReadings, setGameError]
  );

  const confirmCardSelection = useCallback(async () => {
    const latest = useStore.getState().activeGame;
    if (!isTarotGame(latest, artistId) || latest.gameData.selectedCardIndices.length !== 3) {
      return;
    }

    confirmTarotCardSelection();
    await fetchReadings(latest.id);
  }, [artistId, confirmTarotCardSelection, fetchReadings]);

  const flipCard = useCallback(
    (index: number) => {
      const latest = useStore.getState().activeGame;
      if (!isTarotGame(latest, artistId) || latest.status !== 'reading') {
        return;
      }
      const targetReading = latest.gameData.readings[index];
      if (!targetReading || targetReading.isFlipped) {
        return;
      }

      flipTarotCard(index);
      void speak(targetReading.interpretation, `${latest.id}:reading:${index}`);
    },
    [artistId, flipTarotCard, speak]
  );

  const completeReading = useCallback(() => {
    const latest = useStore.getState().activeGame;
    if (isTarotGame(latest, artistId) && latest.gameData.readings.every((reading) => reading.isFlipped)) {
      void speak(latest.gameData.grandFinale ?? '', `${latest.id}:finale`);
    }
    completeTarotReading();
  }, [artistId, completeTarotReading, speak]);

  const abandon = useCallback(() => {
    void stop();
    abandonGame();
  }, [abandonGame, stop]);

  const clear = useCallback(() => {
    void stop();
    clearGame();
  }, [clearGame, stop]);

  useEffect(
    () => () => {
      void stop();
    },
    [stop]
  );

  return {
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
  };
}
