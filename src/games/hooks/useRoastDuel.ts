import { useCallback, useEffect, useMemo, useRef } from 'react';
import { t } from '../../i18n';
import { addScore } from '../../services/scoreManager';
import { useStore } from '../../store/useStore';
import type { Game, GameConfig, JudgeScore, RoastRound } from '../types';
import { GameService } from '../services/GameService';
import { JudgeService } from '../services/JudgeService';

interface UseRoastDuelResult {
  game: Game | null;
  currentRound: RoastRound | null;
  isUserTurn: boolean;
  isArtistStreaming: boolean;
  isJudging: boolean;
  isRoundResult: boolean;
  isGameOver: boolean;
  initGame: (config?: Partial<GameConfig>) => void;
  sendUserRoast: (text: string) => Promise<void>;
  confirmNextRound: () => void;
  handleGameOver: () => Promise<void>;
  abandon: () => void;
  clear: () => void;
}

function buildFallbackJudgeScore(verdict: string): JudgeScore {
  return {
    wit: 0,
    specificity: 0,
    delivery: 0,
    crowdReaction: 0,
    comebackPotential: 0,
    total: 0,
    verdict
  };
}

export function useRoastDuel(artistId: string): UseRoastDuelResult {
  const activeGame = useStore((state) => state.activeGame);
  const startGame = useStore((state) => state.startGame);
  const setCoinFlipResult = useStore((state) => state.setCoinFlipResult);
  const setGameStatus = useStore((state) => state.setGameStatus);
  const submitUserRoast = useStore((state) => state.submitUserRoast);
  const beginArtistStream = useStore((state) => state.beginArtistStream);
  const appendArtistStreamToken = useStore((state) => state.appendArtistStreamToken);
  const finalizeArtistRoast = useStore((state) => state.finalizeArtistRoast);
  const beginJudging = useStore((state) => state.beginJudging);
  const receiveJudgeVerdict = useStore((state) => state.receiveJudgeVerdict);
  const advanceRound = useStore((state) => state.advanceRound);
  const endGame = useStore((state) => state.endGame);
  const abandonGame = useStore((state) => state.abandonGame);
  const clearGame = useStore((state) => state.clearGame);
  const setGameError = useStore((state) => state.setGameError);
  const incrementUsage = useStore((state) => state.incrementUsage);

  const cancelStreamRef = useRef<null | (() => void)>(null);
  const coinFlipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTurnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoredGameIdRef = useRef<string | null>(null);

  const game = useMemo(() => {
    if (!activeGame) {
      return null;
    }
    if (activeGame.gameType !== 'roast-duel' || activeGame.artistId !== artistId) {
      return null;
    }
    return activeGame;
  }, [activeGame, artistId]);

  const currentRound = useMemo(() => {
    if (!game) {
      return null;
    }
    return game.rounds[game.currentRound - 1] ?? null;
  }, [game]);

  const cleanupTimers = useCallback(() => {
    if (coinFlipTimerRef.current) {
      clearTimeout(coinFlipTimerRef.current);
      coinFlipTimerRef.current = null;
    }
    if (startTurnTimerRef.current) {
      clearTimeout(startTurnTimerRef.current);
      startTurnTimerRef.current = null;
    }
  }, []);

  const cancelActiveStream = useCallback(() => {
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }
  }, []);

  const initGame = useCallback(
    (config: Partial<GameConfig> = {}) => {
      cleanupTimers();
      cancelActiveStream();
      const created = startGame(artistId, 'roast-duel', config);
      setGameError(null);

      coinFlipTimerRef.current = setTimeout(() => {
        const firstRoaster: 'user' | 'artist' = Math.random() < 0.5 ? 'user' : 'artist';
        setCoinFlipResult(firstRoaster);
      }, 1200);

      startTurnTimerRef.current = setTimeout(() => {
        const latest = useStore.getState().activeGame;
        if (!latest || latest.id !== created.id || latest.status === 'abandoned') {
          return;
        }
        setGameStatus('user-turn');
      }, 2000);
    },
    [artistId, cancelActiveStream, cleanupTimers, setCoinFlipResult, setGameError, setGameStatus, startGame]
  );

  const runJudge = useCallback(async () => {
    const latestGame = useStore.getState().activeGame;
    if (!latestGame) {
      return;
    }
    const round = latestGame.rounds[latestGame.currentRound - 1];
    if (!round) {
      return;
    }

    beginJudging();
    try {
      const verdict = await JudgeService.evaluate({
        artistId: latestGame.artistId,
        round: latestGame.currentRound,
        totalRounds: latestGame.config.roundCount,
        userRoast: round.userRoast,
        artistRoast: round.artistRoast || round.streamingContent,
        language: 'fr-CA'
      });
      receiveJudgeVerdict(verdict.userScore, verdict.artistScore);
      incrementUsage();
    } catch {
      const fallbackUser = buildFallbackJudgeScore(t('gameErrorJudgeUnavailable'));
      const fallbackArtist = buildFallbackJudgeScore(t('gameErrorJudgeUnavailable'));
      receiveJudgeVerdict(fallbackUser, fallbackArtist);
      setGameError(t('gameErrorJudgeUnavailable'));
    }
  }, [beginJudging, incrementUsage, receiveJudgeVerdict, setGameError]);

  const sendUserRoast = useCallback(
    async (text: string) => {
      const latestGame = useStore.getState().activeGame;
      if (!latestGame || latestGame.status !== 'user-turn') {
        return;
      }

      const normalized = typeof text === 'string' ? text.trim() : '';
      if (!normalized) {
        return;
      }

      setGameError(null);
      submitUserRoast(normalized);
      beginArtistStream();

      const conversationHistory = latestGame.rounds.filter(
        (round) =>
          round.roundNumber < latestGame.currentRound && Boolean(round.userRoast.trim()) && Boolean(round.artistRoast.trim())
      );

      cancelStreamRef.current = await GameService.runArtistTurn({
        artistId: latestGame.artistId,
        roundNumber: latestGame.currentRound,
        totalRounds: latestGame.config.roundCount,
        userRoast: normalized,
        userTotalScore: latestGame.userTotalScore,
        artistTotalScore: latestGame.artistTotalScore,
        conversationHistory,
        language: 'fr-CA',
        onToken: (token) => appendArtistStreamToken(token),
        onComplete: () => {
          finalizeArtistRoast();
          incrementUsage();
          void runJudge();
        },
        onError: () => {
          setGameError(t('gameErrorArtistFailed'));
          setGameStatus('user-turn');
        }
      });
    },
    [
      appendArtistStreamToken,
      beginArtistStream,
      finalizeArtistRoast,
      incrementUsage,
      runJudge,
      setGameError,
      setGameStatus,
      submitUserRoast
    ]
  );

  const confirmNextRound = useCallback(() => {
    const latest = useStore.getState().activeGame;
    if (!latest) {
      return;
    }
    setGameError(null);
    if (latest.currentRound >= latest.config.roundCount) {
      endGame();
      return;
    }
    advanceRound();
  }, [advanceRound, endGame, setGameError]);

  const handleGameOver = useCallback(async () => {
    const latest = useStore.getState().activeGame;
    if (!latest || latest.status !== 'game-over') {
      return;
    }
    if (latest.winner !== 'user') {
      return;
    }
    if (scoredGameIdRef.current === latest.id) {
      return;
    }

    try {
      await addScore('battle_win');
      scoredGameIdRef.current = latest.id;
    } catch {
      // Best effort: score endpoint unavailability should not block game flow.
    }
  }, []);

  const abandon = useCallback(() => {
    cancelActiveStream();
    cleanupTimers();
    abandonGame();
  }, [abandonGame, cancelActiveStream, cleanupTimers]);

  const clear = useCallback(() => {
    cancelActiveStream();
    cleanupTimers();
    clearGame();
  }, [cancelActiveStream, cleanupTimers, clearGame]);

  useEffect(
    () => () => {
      cancelActiveStream();
      cleanupTimers();
    },
    [cancelActiveStream, cleanupTimers]
  );

  return {
    game,
    currentRound,
    isUserTurn: game?.status === 'user-turn',
    isArtistStreaming: game?.status === 'artist-streaming',
    isJudging: game?.status === 'judging',
    isRoundResult: game?.status === 'round-result',
    isGameOver: game?.status === 'game-over',
    initGame,
    sendUserRoast,
    confirmNextRound,
    handleGameOver,
    abandon,
    clear
  };
}
