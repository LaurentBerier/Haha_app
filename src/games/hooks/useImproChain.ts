import { useCallback, useEffect, useMemo, useRef } from 'react';
import { t } from '../../i18n';
import { addScore } from '../../services/scoreManager';
import { useStore } from '../../store/useStore';
import { GameService } from '../services/GameService';
import type { Game, ImproChainData, ImproTurn } from '../types';

interface UseImproChainResult {
  game: Game | null;
  turns: ImproTurn[];
  streamingContent: string;
  isStreaming: boolean;
  isComplete: boolean;
  startGame: () => Promise<void>;
  submitTurn: (text: string) => Promise<void>;
  abandon: () => void;
  clear: () => void;
}

type ImproGame = Game & {
  gameType: 'impro-chain';
  gameData: ImproChainData;
};

function isImproGame(game: Game | null, artistId: string): game is ImproGame {
  return Boolean(
    game && game.artistId === artistId && game.gameType === 'impro-chain' && game.gameData.type === 'impro-chain'
  );
}

export function useImproChain(artistId: string): UseImproChainResult {
  const activeGame = useStore((state) => state.activeGame);
  const startImproGame = useStore((state) => state.startImproGame);
  const submitUserImproTurn = useStore((state) => state.submitUserImproTurn);
  const beginImproArtistStream = useStore((state) => state.beginImproArtistStream);
  const appendImproStreamToken = useStore((state) => state.appendImproStreamToken);
  const finalizeImproArtistTurn = useStore((state) => state.finalizeImproArtistTurn);
  const setGameError = useStore((state) => state.setGameError);
  const abandonGame = useStore((state) => state.abandonGame);
  const clearGame = useStore((state) => state.clearGame);
  const incrementUsage = useStore((state) => state.incrementUsage);

  const cancelStreamRef = useRef<null | (() => void)>(null);
  const scoredGameIdRef = useRef<string | null>(null);

  const game = useMemo(() => {
    if (!isImproGame(activeGame, artistId)) {
      return null;
    }
    return activeGame;
  }, [activeGame, artistId]);

  const turns = useMemo(() => (game && game.gameData.type === 'impro-chain' ? game.gameData.turns : []), [game]);
  const streamingContent = game && game.gameData.type === 'impro-chain' ? game.gameData.streamingContent : '';
  const isStreaming = game && game.gameData.type === 'impro-chain' ? game.gameData.isStreaming : false;
  const isComplete = game?.status === 'complete';

  const cancelActiveStream = useCallback(() => {
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }
  }, []);

  const runCathyTurn = useCallback(
    async (history: ImproTurn[], gameId: string) => {
      beginImproArtistStream();
      cancelStreamRef.current = await GameService.runImproTurn({
        artistId,
        history,
        language: 'fr-CA',
        onToken: (token) => appendImproStreamToken(token),
        onComplete: (content, isEnding) => {
          finalizeImproArtistTurn(content, isEnding);
          incrementUsage();

          if (isEnding) {
            setTimeout(() => {
              const latest = useStore.getState().activeGame;
              if (!latest || latest.id !== gameId || latest.status === 'abandoned') {
                return;
              }
              useStore.getState().setGameStatus('complete');
            }, 280);

            if (scoredGameIdRef.current !== gameId) {
              void addScore('punchline_created')
                .then(() => {
                  scoredGameIdRef.current = gameId;
                })
                .catch(() => {
                  // Best effort for gamification scoring.
                });
            }
          }
        },
        onError: (error) => {
          console.error('[useImproChain] Impro turn failed', error);
          setGameError(t('gameErrorGeneric'));
        }
      });
    },
    [appendImproStreamToken, artistId, beginImproArtistStream, finalizeImproArtistTurn, incrementUsage, setGameError]
  );

  const startGame = useCallback(async () => {
    cancelActiveStream();
    const created = startImproGame(artistId);
    setGameError(null);
    scoredGameIdRef.current = null;
    await runCathyTurn([], created.id);
  }, [artistId, cancelActiveStream, runCathyTurn, setGameError, startImproGame]);

  const submitTurn = useCallback(
    async (text: string) => {
      const latest = useStore.getState().activeGame;
      if (!isImproGame(latest, artistId) || latest.status === 'complete' || latest.status === 'abandoned') {
        return;
      }
      if (latest.gameData.isStreaming) {
        return;
      }

      const normalized = typeof text === 'string' ? text.trim() : '';
      if (!normalized) {
        return;
      }

      setGameError(null);
      submitUserImproTurn(normalized);
      const refreshed = useStore.getState().activeGame;
      if (!isImproGame(refreshed, artistId)) {
        return;
      }
      await runCathyTurn(refreshed.gameData.turns, refreshed.id);
    },
    [artistId, runCathyTurn, setGameError, submitUserImproTurn]
  );

  const abandon = useCallback(() => {
    cancelActiveStream();
    abandonGame();
  }, [abandonGame, cancelActiveStream]);

  const clear = useCallback(() => {
    cancelActiveStream();
    clearGame();
  }, [cancelActiveStream, clearGame]);

  useEffect(
    () => () => {
      cancelActiveStream();
    },
    [cancelActiveStream]
  );

  return {
    game,
    turns,
    streamingContent,
    isStreaming,
    isComplete,
    startGame,
    submitTurn,
    abandon,
    clear
  };
}
