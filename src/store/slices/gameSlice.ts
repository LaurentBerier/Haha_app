import type { StateCreator } from 'zustand';
import type {
  Game,
  GameStatus,
  ImproChainData,
  ImproReward,
  ImproTurn,
  TarotCathyData,
  TarotPoolCard,
  TarotReading,
  TarotTheme,
  VraiInventeData,
  VraiInventeQuestion
} from '../../games/types';
import { TAROT_CARD_POOL } from '../../games/types';
import { generateId } from '../../utils/generateId';
import type { StoreState } from '../useStore';

const VRAI_INVENTE_TOTAL_ROUNDS = 5;

function normalizeText(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTargetTurns(value: number | undefined): 3 | 4 {
  return value === 4 ? 4 : 3;
}

function isImproData(data: Game['gameData']): data is ImproChainData {
  return data.type === 'impro-chain';
}

function isVraiInventeData(data: Game['gameData']): data is VraiInventeData {
  return data.type === 'vrai-ou-invente';
}

function isTarotData(data: Game['gameData']): data is TarotCathyData {
  return data.type === 'tarot-cathy';
}

function pickRandomCards(pool: TarotPoolCard[], count: number): TarotPoolCard[] {
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = shuffled[i];
    const b = shuffled[j];
    if (a !== undefined && b !== undefined) {
      shuffled[i] = b;
      shuffled[j] = a;
    }
  }
  return shuffled.slice(0, count);
}

function buildTarotGame(artistId: string): Game {
  return {
    id: generateId('game'),
    gameType: 'tarot-cathy',
    artistId,
    status: 'theme-select',
    gameData: {
      type: 'tarot-cathy',
      theme: null,
      cardPool: [],
      selectedCardIndices: [],
      readings: [],
      grandFinale: null,
      isLoading: false
    },
    startedAt: new Date().toISOString(),
    endedAt: null,
    error: null
  };
}

function withActiveGame(
  state: StoreState,
  updater: (game: Game) => Game
): StoreState | Pick<StoreState, 'activeGame'> {
  if (!state.activeGame) {
    return state;
  }

  return { activeGame: updater(state.activeGame) };
}

function pushImproTurn(data: ImproChainData, turn: ImproTurn): ImproChainData {
  const content = normalizeText(turn.content);
  if (!content) {
    return data;
  }

  return {
    ...data,
    turns: [...data.turns, { role: turn.role, content }]
  };
}

interface StartImproGameOptions {
  theme?: string | null;
  targetUserTurns?: number;
}

function buildImproGame(artistId: string, options?: StartImproGameOptions): Game {
  const theme = normalizeText(options?.theme ?? '');
  const targetUserTurns = normalizeTargetTurns(options?.targetUserTurns);

  return {
    id: generateId('game'),
    gameType: 'impro-chain',
    artistId,
    status: 'active',
    gameData: {
      type: 'impro-chain',
      theme: theme || null,
      targetUserTurns,
      userTurnsCount: 0,
      turns: [],
      rewards: [],
      streamingContent: '',
      isStreaming: false
    },
    startedAt: new Date().toISOString(),
    endedAt: null,
    error: null
  };
}

function buildVraiInventeGame(artistId: string): Game {
  return {
    id: generateId('game'),
    gameType: 'vrai-ou-invente',
    artistId,
    status: 'loading',
    gameData: {
      type: 'vrai-ou-invente',
      questions: [],
      currentIndex: 0,
      score: 0,
      isLoading: true
    },
    startedAt: new Date().toISOString(),
    endedAt: null,
    error: null
  };
}

export interface GameSlice {
  activeGame: Game | null;
  startImproGame: (artistId: string, options?: StartImproGameOptions) => Game;
  addImproTurn: (role: ImproTurn['role'], content: string) => void;
  addImproReward: (reward: ImproReward) => void;
  beginImproArtistStream: () => void;
  appendImproStreamToken: (token: string) => void;
  finalizeImproArtistTurn: (content: string, isEnding: boolean) => void;
  submitUserImproTurn: (text: string) => void;

  startVraiInventeGame: (artistId: string) => Game;
  receiveVraiInventeQuestion: (question: VraiInventeQuestion) => void;
  submitVraiInventeAnswer: (index: number) => void;
  nextVraiInventeQuestion: () => void;

  startTarotGame: (artistId: string) => Game;
  selectTarotTheme: (theme: TarotTheme) => void;
  toggleTarotCardSelection: (cardIndex: number) => void;
  confirmTarotCardSelection: () => void;
  receiveTarotReadings: (readings: Omit<TarotReading, 'isFlipped'>[], grandFinale: string) => void;
  flipTarotCard: (index: number) => void;
  completeTarotReading: () => void;

  setGameStatus: (status: GameStatus) => void;
  setGameError: (message: string | null) => void;
  abandonGame: () => void;
  clearGame: () => void;
}

export const createGameSlice: StateCreator<StoreState, [], [], GameSlice> = (set) => ({
  activeGame: null,

  startImproGame: (artistId, options) => {
    const game = buildImproGame(artistId, options);
    set({ activeGame: game });
    return game;
  },

  addImproTurn: (role, content) =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'impro-chain' || !isImproData(game.gameData)) {
          return game;
        }

        return {
          ...game,
          gameData: pushImproTurn(game.gameData, { role, content }),
          error: null
        };
      })
    ),

  addImproReward: (reward) =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'impro-chain' || !isImproData(game.gameData)) {
          return game;
        }

        const label = normalizeText(reward.label);
        if (!label || typeof reward.points !== 'number' || !Number.isFinite(reward.points) || reward.points <= 0) {
          return game;
        }

        return {
          ...game,
          gameData: {
            ...game.gameData,
            rewards: [
              ...game.gameData.rewards,
              {
                id: reward.id || generateId('impro-reward'),
                userTurnNumber: Math.max(1, Math.floor(reward.userTurnNumber || 1)),
                emoji: reward.emoji || '🎉',
                label,
                points: Math.max(1, Math.floor(reward.points))
              }
            ]
          }
        };
      })
    ),

  beginImproArtistStream: () =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'impro-chain' || !isImproData(game.gameData)) {
          return game;
        }

        return {
          ...game,
          status: 'active',
          gameData: {
            ...game.gameData,
            streamingContent: '',
            isStreaming: true
          }
        };
      })
    ),

  appendImproStreamToken: (token) =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'impro-chain' || !isImproData(game.gameData) || !token) {
          return game;
        }

        return {
          ...game,
          gameData: {
            ...game.gameData,
            streamingContent: `${game.gameData.streamingContent}${token}`,
            isStreaming: true
          }
        };
      })
    ),

  finalizeImproArtistTurn: (content, isEnding) =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'impro-chain' || !isImproData(game.gameData)) {
          return game;
        }

        const normalized = normalizeText(content);
        const nextData = {
          ...pushImproTurn(
            {
              ...game.gameData,
              isStreaming: false,
              streamingContent: ''
            },
            { role: 'artist', content: normalized }
          ),
          isStreaming: false,
          streamingContent: ''
        };

        if (!isEnding) {
          return {
            ...game,
            status: 'active',
            gameData: nextData,
            error: null
          };
        }

        return {
          ...game,
          status: 'cathy-ending',
          gameData: nextData,
          endedAt: game.endedAt ?? new Date().toISOString(),
          error: null
        };
      })
    ),

  submitUserImproTurn: (text) =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'impro-chain' || !isImproData(game.gameData)) {
          return game;
        }

        return {
          ...game,
          status: 'active',
          gameData: {
            ...pushImproTurn(game.gameData, { role: 'user', content: text }),
            userTurnsCount: game.gameData.userTurnsCount + 1
          },
          error: null
        };
      })
    ),

  startVraiInventeGame: (artistId) => {
    const game = buildVraiInventeGame(artistId);
    set({ activeGame: game });
    return game;
  },

  receiveVraiInventeQuestion: (question) =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'vrai-ou-invente' || !isVraiInventeData(game.gameData)) {
          return game;
        }

        const index = Math.max(0, game.gameData.currentIndex);
        const questions = game.gameData.questions.slice();
        if (questions.length <= index) {
          questions.push(question);
        } else {
          questions[index] = question;
        }

        return {
          ...game,
          status: 'question',
          gameData: {
            ...game.gameData,
            questions,
            isLoading: false
          },
          error: null
        };
      })
    ),

  submitVraiInventeAnswer: (index) =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'vrai-ou-invente' || !isVraiInventeData(game.gameData)) {
          return game;
        }

        const current = game.gameData.questions[game.gameData.currentIndex];
        if (!current || current.userAnswerIndex !== null) {
          return game;
        }

        const isCorrect = Boolean(current.statements[index]?.isTrue);
        const questions = game.gameData.questions.slice();
        questions[game.gameData.currentIndex] = {
          ...current,
          userAnswerIndex: index,
          isCorrect
        };

        return {
          ...game,
          status: 'revealed',
          gameData: {
            ...game.gameData,
            questions,
            score: game.gameData.score + (isCorrect ? 1 : 0),
            isLoading: false
          },
          error: null
        };
      })
    ),

  nextVraiInventeQuestion: () =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'vrai-ou-invente' || !isVraiInventeData(game.gameData)) {
          return game;
        }

        const nextIndex = game.gameData.currentIndex + 1;
        if (nextIndex >= VRAI_INVENTE_TOTAL_ROUNDS) {
          return {
            ...game,
            status: 'complete',
            gameData: {
              ...game.gameData,
              isLoading: false
            },
            endedAt: game.endedAt ?? new Date().toISOString(),
            error: null
          };
        }

        return {
          ...game,
          status: 'loading',
          gameData: {
            ...game.gameData,
            currentIndex: nextIndex,
            isLoading: true
          },
          error: null
        };
      })
    ),

  startTarotGame: (artistId) => {
    const game = buildTarotGame(artistId);
    set({ activeGame: game });
    return game;
  },

  selectTarotTheme: (theme) =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'tarot-cathy' || !isTarotData(game.gameData)) {
          return game;
        }

        return {
          ...game,
          status: 'card-select',
          gameData: {
            ...game.gameData,
            theme,
            cardPool: pickRandomCards(TAROT_CARD_POOL, 5),
            selectedCardIndices: []
          },
          error: null
        };
      })
    ),

  toggleTarotCardSelection: (cardIndex) =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'tarot-cathy' || !isTarotData(game.gameData)) {
          return game;
        }

        const { selectedCardIndices, cardPool } = game.gameData;
        if (cardIndex < 0 || cardIndex >= cardPool.length) {
          return game;
        }

        const alreadySelected = selectedCardIndices.includes(cardIndex);
        let next: number[];
        if (alreadySelected) {
          next = selectedCardIndices.filter((i) => i !== cardIndex);
        } else if (selectedCardIndices.length < 3) {
          next = [...selectedCardIndices, cardIndex];
        } else {
          return game;
        }

        return {
          ...game,
          gameData: {
            ...game.gameData,
            selectedCardIndices: next
          }
        };
      })
    ),

  confirmTarotCardSelection: () =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'tarot-cathy' || !isTarotData(game.gameData)) {
          return game;
        }
        if (game.gameData.selectedCardIndices.length !== 3) {
          return game;
        }

        return {
          ...game,
          status: 'loading',
          gameData: {
            ...game.gameData,
            isLoading: true
          },
          error: null
        };
      })
    ),

  receiveTarotReadings: (readings, grandFinale) =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'tarot-cathy' || !isTarotData(game.gameData)) {
          return game;
        }

        return {
          ...game,
          status: 'reading',
          gameData: {
            ...game.gameData,
            readings: readings.map((r) => ({ ...r, isFlipped: false })),
            grandFinale: grandFinale || null,
            isLoading: false
          },
          error: null
        };
      })
    ),

  flipTarotCard: (index) =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'tarot-cathy' || !isTarotData(game.gameData)) {
          return game;
        }

        const { readings } = game.gameData;
        const targetReading = readings[index];
        if (index < 0 || index >= readings.length || !targetReading || targetReading.isFlipped) {
          return game;
        }

        const nextReadings = readings.map((r, i) =>
          i === index ? { ...r, isFlipped: true } : r
        );

        return {
          ...game,
          status: 'reading',
          gameData: {
            ...game.gameData,
            readings: nextReadings
          }
        };
      })
    ),

  completeTarotReading: () =>
    set((state) =>
      withActiveGame(state, (game) => {
        if (game.gameType !== 'tarot-cathy' || !isTarotData(game.gameData)) {
          return game;
        }
        if (!game.gameData.readings.every((r) => r.isFlipped)) {
          return game;
        }

        return {
          ...game,
          status: 'complete',
          endedAt: game.endedAt ?? new Date().toISOString()
        };
      })
    ),

  setGameStatus: (status) =>
    set((state) =>
      withActiveGame(state, (game) => {
        const nextEndedAt =
          status === 'complete' || status === 'abandoned'
            ? game.endedAt ?? new Date().toISOString()
            : game.endedAt;
        return {
          ...game,
          status,
          endedAt: nextEndedAt
        };
      })
    ),

  setGameError: (message) =>
    set((state) =>
      withActiveGame(state, (game) => ({
        ...game,
        status: message ? 'abandoned' : game.status,
        error: normalizeText(message ?? '') || null
      }))
    ),

  abandonGame: () =>
    set((state) =>
      withActiveGame(state, (game) => ({
        ...game,
        status: 'abandoned',
        endedAt: game.endedAt ?? new Date().toISOString()
      }))
    ),

  clearGame: () => set({ activeGame: null })
});
