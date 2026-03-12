import { useCallback, useEffect, useMemo, useRef } from 'react';
import { t } from '../../i18n';
import { addScore } from '../../services/scoreManager';
import { useStore } from '../../store/useStore';
import { generateId } from '../../utils/generateId';
import { GameService } from '../services/GameService';
import type { Game, ImproChainData, ImproReward, ImproTurn } from '../types';

interface UseImproChainResult {
  game: Game | null;
  turns: ImproTurn[];
  rewards: ImproReward[];
  theme: string | null;
  targetUserTurns: 3 | 4;
  userTurnsCount: number;
  streamingContent: string;
  isStreaming: boolean;
  isComplete: boolean;
  startGame: (theme?: string | null) => Promise<void>;
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

const INTERVENTION_POINTS = 10;
const REWARD_VARIANTS = [
  { emoji: '❤️', fr: 'Touché en plein coeur', en: 'Right in the feels' },
  { emoji: '👍', fr: 'Solide repartie', en: 'Solid comeback' },
  { emoji: '😂', fr: 'Punchline qui frappe', en: 'Punchline landed' },
  { emoji: '🔥', fr: 'Ca chauffe fort', en: 'That was spicy' },
  { emoji: '‼️', fr: 'Moment legendaire', en: 'Legendary moment' }
] as const;

function pickRewardLabel(text: string, turnNumber: number, language: string): { emoji: string; label: string } {
  const seed = `${text}-${turnNumber}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  const choice = REWARD_VARIANTS[hash % REWARD_VARIANTS.length] ?? REWARD_VARIANTS[0];
  return {
    emoji: choice.emoji,
    label: language.startsWith('en') ? choice.en : choice.fr
  };
}

export function useImproChain(artistId: string): UseImproChainResult {
  const activeGame = useStore((state) => state.activeGame);
  const startImproGame = useStore((state) => state.startImproGame);
  const submitUserImproTurn = useStore((state) => state.submitUserImproTurn);
  const addImproReward = useStore((state) => state.addImproReward);
  const beginImproArtistStream = useStore((state) => state.beginImproArtistStream);
  const appendImproStreamToken = useStore((state) => state.appendImproStreamToken);
  const finalizeImproArtistTurn = useStore((state) => state.finalizeImproArtistTurn);
  const setGameError = useStore((state) => state.setGameError);
  const abandonGame = useStore((state) => state.abandonGame);
  const clearGame = useStore((state) => state.clearGame);
  const incrementUsage = useStore((state) => state.incrementUsage);
  const userProfile = useStore((state) => state.userProfile);
  const language = useStore((state) => state.language);

  const cancelStreamRef = useRef<null | (() => void)>(null);

  const game = useMemo(() => {
    if (!isImproGame(activeGame, artistId)) {
      return null;
    }
    return activeGame;
  }, [activeGame, artistId]);

  const turns = useMemo(() => (game && game.gameData.type === 'impro-chain' ? game.gameData.turns : []), [game]);
  const rewards = useMemo(() => (game && game.gameData.type === 'impro-chain' ? game.gameData.rewards : []), [game]);
  const theme = game && game.gameData.type === 'impro-chain' ? game.gameData.theme : null;
  const targetUserTurns = game && game.gameData.type === 'impro-chain' ? game.gameData.targetUserTurns : 3;
  const userTurnsCount = game && game.gameData.type === 'impro-chain' ? game.gameData.userTurnsCount : 0;
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
    async (snapshot: ImproGame) => {
      const gameId = snapshot.id;
      beginImproArtistStream();
      cancelStreamRef.current = await GameService.runImproTurn({
        artistId,
        history: snapshot.gameData.turns,
        theme: snapshot.gameData.theme,
        targetUserTurns: snapshot.gameData.targetUserTurns,
        userTurnCount: snapshot.gameData.userTurnsCount,
        language,
        userProfile,
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
          }
        },
        onError: (error) => {
          console.error('[useImproChain] Impro turn failed', error);
          setGameError(t('gameErrorGeneric'));
        }
      });
    },
    [
      appendImproStreamToken,
      artistId,
      beginImproArtistStream,
      finalizeImproArtistTurn,
      incrementUsage,
      language,
      setGameError,
      userProfile
    ]
  );

  const startGame = useCallback(async (themeValue?: string | null) => {
    cancelActiveStream();
    const created = startImproGame(artistId, {
      theme: typeof themeValue === 'string' ? themeValue.trim() : '',
      targetUserTurns: Math.random() < 0.5 ? 3 : 4
    });
    if (!isImproGame(created, artistId)) {
      return;
    }
    setGameError(null);
    await runCathyTurn(created);
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

      const rewardMeta = pickRewardLabel(normalized, refreshed.gameData.userTurnsCount, language);
      addImproReward({
        id: generateId('impro-reward'),
        userTurnNumber: refreshed.gameData.userTurnsCount,
        emoji: rewardMeta.emoji,
        label: rewardMeta.label,
        points: INTERVENTION_POINTS
      });

      void addScore('punchline_created').catch(() => {
        // Best effort for gamification scoring.
      });

      await runCathyTurn(refreshed);
    },
    [addImproReward, artistId, language, runCathyTurn, setGameError, submitUserImproTurn]
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
    rewards,
    theme,
    targetUserTurns,
    userTurnsCount,
    streamingContent,
    isStreaming,
    isComplete,
    startGame,
    submitTurn,
    abandon,
    clear
  };
}
