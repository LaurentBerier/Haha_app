import { useCallback, useEffect, useMemo, useRef } from 'react';
import { t } from '../../i18n';
import { addScore } from '../../services/scoreManager';
import { useStore } from '../../store/useStore';
import { useGameTts } from './useGameTts';
import { VraiInventeService } from '../services/VraiInventeService';
import type { Game, VraiInventeData, VraiInventeQuestion } from '../types';

const TOTAL_QUESTIONS = 5;

interface UseVraiOuInventeResult {
  game: Game | null;
  currentQuestion: VraiInventeQuestion | null;
  currentIndex: number;
  totalQuestions: number;
  score: number;
  isLoading: boolean;
  isRevealed: boolean;
  isComplete: boolean;
  startGame: () => Promise<void>;
  submitAnswer: (index: number) => void;
  nextQuestion: () => Promise<void>;
  abandon: () => void;
  clear: () => void;
}

type VraiOuInventeGame = Game & {
  gameType: 'vrai-ou-invente';
  gameData: VraiInventeData;
};

function isVraiOuInventeGame(game: Game | null, artistId: string): game is VraiOuInventeGame {
  return Boolean(
    game &&
      game.artistId === artistId &&
      game.gameType === 'vrai-ou-invente' &&
      game.gameData.type === 'vrai-ou-invente'
  );
}

function toSpokenQuestion(question: VraiInventeQuestion): string {
  return question.statements
    .map((statement, index) => `${index + 1}. ${statement.text}`)
    .join(' ');
}

export function useVraiOuInvente(artistId: string): UseVraiOuInventeResult {
  const activeGame = useStore((state) => state.activeGame);
  const startVraiInventeGame = useStore((state) => state.startVraiInventeGame);
  const receiveVraiInventeQuestion = useStore((state) => state.receiveVraiInventeQuestion);
  const submitVraiInventeAnswer = useStore((state) => state.submitVraiInventeAnswer);
  const nextVraiInventeQuestion = useStore((state) => state.nextVraiInventeQuestion);
  const setGameError = useStore((state) => state.setGameError);
  const abandonGame = useStore((state) => state.abandonGame);
  const clearGame = useStore((state) => state.clearGame);
  const incrementUsage = useStore((state) => state.incrementUsage);
  const language = useStore((state) => state.language);
  const { speak, stop } = useGameTts({
    artistId,
    language,
    contextTag: 'vrai-ou-invente'
  });

  const rewardedGameIdRef = useRef<string | null>(null);
  const requestInFlightRef = useRef(false);

  const game = useMemo(() => {
    if (!isVraiOuInventeGame(activeGame, artistId)) {
      return null;
    }
    return activeGame;
  }, [activeGame, artistId]);

  const currentIndex = game && game.gameData.type === 'vrai-ou-invente' ? game.gameData.currentIndex : 0;
  const currentQuestion =
    game && game.gameData.type === 'vrai-ou-invente' ? game.gameData.questions[currentIndex] ?? null : null;
  const score = game && game.gameData.type === 'vrai-ou-invente' ? game.gameData.score : 0;
  const isLoading = Boolean(game && game.status === 'loading');
  const isRevealed = game?.status === 'revealed';
  const isComplete = game?.status === 'complete';

  const fetchQuestion = useCallback(
    async (gameId: string) => {
      if (requestInFlightRef.current) {
        return;
      }
      requestInFlightRef.current = true;
      try {
        const question = await VraiInventeService.fetchQuestion({
          artistId,
          language: 'fr-CA'
        });
        const latest = useStore.getState().activeGame;
        if (!isVraiOuInventeGame(latest, artistId) || latest.id !== gameId || latest.status === 'abandoned') {
          return;
        }
        const questionIndex = latest.gameData.currentIndex;
        receiveVraiInventeQuestion(question);
        void speak(toSpokenQuestion(question), `${gameId}:question:${questionIndex}`);
      } catch (error) {
        console.error('[useVraiOuInvente] Question fetch failed', error);
        setGameError(t('gameErrorGeneric'));
      } finally {
        requestInFlightRef.current = false;
      }
    },
    [artistId, receiveVraiInventeQuestion, setGameError, speak]
  );

  const startGame = useCallback(async () => {
    void stop();
    const created = startVraiInventeGame(artistId);
    setGameError(null);
    rewardedGameIdRef.current = null;
    await fetchQuestion(created.id);
  }, [artistId, fetchQuestion, setGameError, startVraiInventeGame, stop]);

  const submitAnswer = useCallback(
    (index: number) => {
      const latest = useStore.getState().activeGame;
      if (!isVraiOuInventeGame(latest, artistId) || latest.status !== 'question') {
        return;
      }
      const question = latest.gameData.questions[latest.gameData.currentIndex];
      if (!question || question.userAnswerIndex !== null) {
        return;
      }

      submitVraiInventeAnswer(index);
      incrementUsage();

      const refreshed = useStore.getState().activeGame;
      if (!isVraiOuInventeGame(refreshed, artistId) || refreshed.status !== 'revealed') {
        return;
      }
      const revealedQuestion = refreshed.gameData.questions[refreshed.gameData.currentIndex];
      if (!revealedQuestion) {
        return;
      }
      const verdict = revealedQuestion.isCorrect ? t('gameVraiInventeCorrect') : t('gameVraiInventeWrong');
      void speak(
        `${verdict} ${revealedQuestion.explanation}`,
        `${refreshed.id}:reveal:${refreshed.gameData.currentIndex}`
      );
    },
    [artistId, incrementUsage, speak, submitVraiInventeAnswer]
  );

  const nextQuestion = useCallback(async () => {
    const latest = useStore.getState().activeGame;
    if (!isVraiOuInventeGame(latest, artistId)) {
      return;
    }

    nextVraiInventeQuestion();
    const refreshed = useStore.getState().activeGame;
    if (!isVraiOuInventeGame(refreshed, artistId)) {
      return;
    }

    if (refreshed.status === 'complete') {
      if (refreshed.gameData.score === TOTAL_QUESTIONS && rewardedGameIdRef.current !== refreshed.id) {
        void addScore('battle_win')
          .then(() => {
            rewardedGameIdRef.current = refreshed.id;
          })
          .catch(() => {
            // Best effort for gamification scoring.
          });
      }
      return;
    }

    if (refreshed.status === 'loading') {
      await fetchQuestion(refreshed.id);
    }
  }, [artistId, fetchQuestion, nextVraiInventeQuestion]);

  const abandon = useCallback(() => {
    void stop();
    abandonGame();
  }, [abandonGame, stop]);

  const clear = useCallback(() => {
    void stop();
    clearGame();
  }, [clearGame, stop]);

  useEffect(() => {
    if (!game || game.status !== 'complete' || game.gameData.type !== 'vrai-ou-invente') {
      return;
    }
    if (game.gameData.score !== TOTAL_QUESTIONS || rewardedGameIdRef.current === game.id) {
      return;
    }

    void addScore('battle_win')
      .then(() => {
        rewardedGameIdRef.current = game.id;
      })
      .catch(() => {
        // Best effort for gamification scoring.
      });
  }, [game]);

  useEffect(
    () => () => {
      void stop();
    },
    [stop]
  );

  return {
    game,
    currentQuestion,
    currentIndex,
    totalQuestions: TOTAL_QUESTIONS,
    score,
    isLoading,
    isRevealed,
    isComplete,
    startGame,
    submitAnswer,
    nextQuestion,
    abandon,
    clear
  };
}
