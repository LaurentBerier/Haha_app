import type { StateCreator } from 'zustand';
import type { Game, GameConfig, GameStatus, GameType, JudgeScore, RoastRound } from '../../games/types';
import { generateId } from '../../utils/generateId';
import type { StoreState } from '../useStore';

function createRound(roundNumber: number): RoastRound {
  return {
    roundNumber,
    userRoast: '',
    artistRoast: '',
    streamingContent: '',
    isStreaming: false,
    isJudging: false,
    userScore: null,
    artistScore: null,
    winner: null
  };
}

function clampRoundCount(value: number | undefined): 3 | 5 | 7 {
  if (value === 5 || value === 7) {
    return value;
  }
  return 3;
}

function getWinnerFromTotals(userTotal: number, artistTotal: number): 'user' | 'artist' | 'tie' {
  if (userTotal > artistTotal) {
    return 'user';
  }
  if (artistTotal > userTotal) {
    return 'artist';
  }
  return 'tie';
}

function getRoundWinner(userScore: JudgeScore, artistScore: JudgeScore): 'user' | 'artist' | 'tie' {
  return getWinnerFromTotals(userScore.total, artistScore.total);
}

export interface GameSlice {
  activeGame: Game | null;
  startGame: (artistId: string, gameType: GameType, config?: Partial<GameConfig>) => Game;
  setCoinFlipResult: (firstRoaster: 'user' | 'artist') => void;
  setGameStatus: (status: GameStatus) => void;
  submitUserRoast: (text: string) => void;
  beginArtistStream: () => void;
  appendArtistStreamToken: (token: string) => void;
  finalizeArtistRoast: () => void;
  beginJudging: () => void;
  receiveJudgeVerdict: (userScore: JudgeScore, artistScore: JudgeScore) => void;
  advanceRound: () => void;
  endGame: () => void;
  abandonGame: () => void;
  clearGame: () => void;
  setGameError: (message: string | null) => void;
}

export const createGameSlice: StateCreator<StoreState, [], [], GameSlice> = (set) => ({
  activeGame: null,
  startGame: (artistId, gameType, config = {}) => {
    const game: Game = {
      id: generateId('game'),
      gameType,
      artistId,
      status: 'lobby',
      config: {
        roundCount: clampRoundCount(config.roundCount),
        theme: typeof config.theme === 'string' && config.theme.trim() ? config.theme.trim() : null
      },
      rounds: [createRound(1)],
      currentRound: 1,
      firstRoaster: 'user',
      userTotalScore: 0,
      artistTotalScore: 0,
      winner: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      error: null
    };

    set({ activeGame: game });
    return game;
  },
  setCoinFlipResult: (firstRoaster) =>
    set((state) => {
      if (!state.activeGame) {
        return state;
      }
      return {
        activeGame: {
          ...state.activeGame,
          firstRoaster,
          status: 'coin-flip',
          error: null
        }
      };
    }),
  setGameStatus: (status) =>
    set((state) => {
      if (!state.activeGame) {
        return state;
      }
      return {
        activeGame: {
          ...state.activeGame,
          status
        }
      };
    }),
  submitUserRoast: (text) =>
    set((state) => {
      const game = state.activeGame;
      if (!game) {
        return state;
      }
      const currentIndex = Math.max(0, game.currentRound - 1);
      const currentRound = game.rounds[currentIndex];
      if (!currentRound) {
        return state;
      }
      const normalized = typeof text === 'string' ? text.trim() : '';
      if (!normalized) {
        return state;
      }

      const nextRounds = game.rounds.slice();
      nextRounds[currentIndex] = {
        ...currentRound,
        userRoast: normalized
      };

      return {
        activeGame: {
          ...game,
          rounds: nextRounds,
          status: 'artist-streaming',
          error: null
        }
      };
    }),
  beginArtistStream: () =>
    set((state) => {
      const game = state.activeGame;
      if (!game) {
        return state;
      }
      const currentIndex = Math.max(0, game.currentRound - 1);
      const currentRound = game.rounds[currentIndex];
      if (!currentRound) {
        return state;
      }

      const nextRounds = game.rounds.slice();
      nextRounds[currentIndex] = {
        ...currentRound,
        isStreaming: true,
        streamingContent: ''
      };

      return {
        activeGame: {
          ...game,
          rounds: nextRounds,
          status: 'artist-streaming'
        }
      };
    }),
  appendArtistStreamToken: (token) =>
    set((state) => {
      const game = state.activeGame;
      if (!game || !token) {
        return state;
      }
      const currentIndex = Math.max(0, game.currentRound - 1);
      const currentRound = game.rounds[currentIndex];
      if (!currentRound) {
        return state;
      }

      const nextRounds = game.rounds.slice();
      nextRounds[currentIndex] = {
        ...currentRound,
        streamingContent: `${currentRound.streamingContent}${token}`,
        isStreaming: true
      };

      return {
        activeGame: {
          ...game,
          rounds: nextRounds
        }
      };
    }),
  finalizeArtistRoast: () =>
    set((state) => {
      const game = state.activeGame;
      if (!game) {
        return state;
      }
      const currentIndex = Math.max(0, game.currentRound - 1);
      const currentRound = game.rounds[currentIndex];
      if (!currentRound) {
        return state;
      }

      const artistRoast = currentRound.streamingContent.trim();
      const nextRounds = game.rounds.slice();
      nextRounds[currentIndex] = {
        ...currentRound,
        artistRoast,
        isStreaming: false
      };

      return {
        activeGame: {
          ...game,
          rounds: nextRounds
        }
      };
    }),
  beginJudging: () =>
    set((state) => {
      const game = state.activeGame;
      if (!game) {
        return state;
      }
      const currentIndex = Math.max(0, game.currentRound - 1);
      const currentRound = game.rounds[currentIndex];
      if (!currentRound) {
        return state;
      }

      const nextRounds = game.rounds.slice();
      nextRounds[currentIndex] = {
        ...currentRound,
        isJudging: true
      };

      return {
        activeGame: {
          ...game,
          rounds: nextRounds,
          status: 'judging'
        }
      };
    }),
  receiveJudgeVerdict: (userScore, artistScore) =>
    set((state) => {
      const game = state.activeGame;
      if (!game) {
        return state;
      }

      const currentIndex = Math.max(0, game.currentRound - 1);
      const currentRound = game.rounds[currentIndex];
      if (!currentRound) {
        return state;
      }

      const winner = getRoundWinner(userScore, artistScore);
      const nextRounds = game.rounds.slice();
      nextRounds[currentIndex] = {
        ...currentRound,
        isJudging: false,
        userScore,
        artistScore,
        winner
      };

      return {
        activeGame: {
          ...game,
          rounds: nextRounds,
          userTotalScore: game.userTotalScore + userScore.total,
          artistTotalScore: game.artistTotalScore + artistScore.total,
          status: 'round-result',
          error: null
        }
      };
    }),
  advanceRound: () =>
    set((state) => {
      const game = state.activeGame;
      if (!game) {
        return state;
      }

      if (game.currentRound >= game.config.roundCount) {
        return {
          activeGame: {
            ...game,
            status: 'game-over',
            endedAt: game.endedAt ?? new Date().toISOString(),
            winner: getWinnerFromTotals(game.userTotalScore, game.artistTotalScore)
          }
        };
      }

      const nextRoundNumber = game.currentRound + 1;
      return {
        activeGame: {
          ...game,
          currentRound: nextRoundNumber,
          rounds: [...game.rounds, createRound(nextRoundNumber)],
          status: 'user-turn',
          error: null
        }
      };
    }),
  endGame: () =>
    set((state) => {
      const game = state.activeGame;
      if (!game) {
        return state;
      }
      return {
        activeGame: {
          ...game,
          status: 'game-over',
          endedAt: game.endedAt ?? new Date().toISOString(),
          winner: getWinnerFromTotals(game.userTotalScore, game.artistTotalScore)
        }
      };
    }),
  abandonGame: () =>
    set((state) => {
      const game = state.activeGame;
      if (!game) {
        return state;
      }
      return {
        activeGame: {
          ...game,
          status: 'abandoned',
          endedAt: game.endedAt ?? new Date().toISOString()
        }
      };
    }),
  clearGame: () => set({ activeGame: null }),
  setGameError: (message) =>
    set((state) => {
      const game = state.activeGame;
      if (!game) {
        return state;
      }
      return {
        activeGame: {
          ...game,
          error: typeof message === 'string' && message.trim() ? message.trim() : null
        }
      };
    })
});
