import React from 'react';
import { renderToString } from 'react-dom/server';
import { useImproChain } from './useImproChain';
import { useTarotCathy } from './useTarotCathy';
import { useVraiOuInvente } from './useVraiOuInvente';
import { GameService } from '../services/GameService';
import { VraiInventeService } from '../services/VraiInventeService';
import type { Game, TarotReading, VraiInventeQuestion } from '../types';

type Selector<TState, TResult> = (state: TState) => TResult;

interface MockStoreState {
  activeGame: Game | null;
  language: string;
  userProfile: null;
  setGameError: jest.Mock;
  incrementUsage: jest.Mock;
  clearGame: jest.Mock;
  abandonGame: jest.Mock;
  startImproGame: jest.Mock;
  submitUserImproTurn: jest.Mock;
  addImproReward: jest.Mock;
  beginImproArtistStream: jest.Mock;
  appendImproStreamToken: jest.Mock;
  finalizeImproArtistTurn: jest.Mock;
  startVraiInventeGame: jest.Mock;
  receiveVraiInventeQuestion: jest.Mock;
  submitVraiInventeAnswer: jest.Mock;
  nextVraiInventeQuestion: jest.Mock;
  startTarotGame: jest.Mock;
  selectTarotTheme: jest.Mock;
  toggleTarotCardSelection: jest.Mock;
  confirmTarotCardSelection: jest.Mock;
  receiveTarotReadings: jest.Mock;
  flipTarotCard: jest.Mock;
  completeTarotReading: jest.Mock;
}

const mockStoreRef: { current: MockStoreState | null } = { current: null };
const mockSpeak = jest.fn<Promise<void>, [string, string]>(async () => undefined);
const mockStop = jest.fn<Promise<void>, []>(async () => undefined);

jest.mock('../../store/useStore', () => {
  const useStore = <TResult>(selector: Selector<MockStoreState, TResult>): TResult => {
    if (!mockStoreRef.current) {
      throw new Error('Mock store state is not initialized');
    }
    return selector(mockStoreRef.current);
  };

  Object.assign(useStore, {
    getState: () => {
      if (!mockStoreRef.current) {
        throw new Error('Mock store state is not initialized');
      }
      return mockStoreRef.current;
    }
  });

  return { useStore };
});

jest.mock('./useGameTts', () => ({
  useGameTts: () => ({
    speak: (...args: [string, string]) => mockSpeak(...args),
    stop: () => mockStop()
  })
}));

jest.mock('../services/GameService', () => ({
  GameService: {
    runImproTurn: jest.fn(async (params: { onComplete: (content: string, isEnding: boolean) => void }) => {
      params.onComplete('Replique Cathy de test', false);
      return () => {
        // noop
      };
    })
  }
}));

jest.mock('../services/VraiInventeService', () => ({
  VraiInventeService: {
    fetchQuestion: jest.fn(async () => ({
      statements: [
        { text: 'Premiere verite', isTrue: true },
        { text: 'Deuxieme verite', isTrue: true },
        { text: 'Mensonge invente', isTrue: false }
      ],
      explanation: 'La troisieme etait inventee.',
      userAnswerIndex: null,
      isCorrect: null
    }))
  }
}));

function createMockState(): MockStoreState {
  const state: Partial<MockStoreState> = {
    activeGame: null,
    language: 'fr-CA',
    userProfile: null,
    setGameError: jest.fn(),
    incrementUsage: jest.fn(),
    clearGame: jest.fn(() => {
      state.activeGame = null;
    }),
    abandonGame: jest.fn(),
    submitUserImproTurn: jest.fn(),
    addImproReward: jest.fn(),
    beginImproArtistStream: jest.fn(),
    appendImproStreamToken: jest.fn(),
    finalizeImproArtistTurn: jest.fn(),
    nextVraiInventeQuestion: jest.fn(),
    selectTarotTheme: jest.fn(),
    toggleTarotCardSelection: jest.fn(),
    confirmTarotCardSelection: jest.fn(),
    receiveTarotReadings: jest.fn()
  };

  state.startImproGame = jest.fn((artistId: string) => {
    const game: Game = {
      id: 'game-impro',
      artistId,
      gameType: 'impro-chain',
      status: 'active',
      gameData: {
        type: 'impro-chain',
        theme: null,
        targetUserTurns: 3,
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
    state.activeGame = game;
    return game;
  });

  state.finalizeImproArtistTurn = jest.fn((content: string) => {
    const current = state.activeGame;
    if (!current || current.gameData.type !== 'impro-chain') {
      return;
    }
    state.activeGame = {
      ...current,
      gameData: {
        ...current.gameData,
        turns: [...current.gameData.turns, { role: 'artist', content }],
        isStreaming: false
      }
    };
  });

  state.startVraiInventeGame = jest.fn((artistId: string) => {
    const game: Game = {
      id: 'game-vrai',
      artistId,
      gameType: 'vrai-ou-invente',
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
    state.activeGame = game;
    return game;
  });

  state.receiveVraiInventeQuestion = jest.fn((question: VraiInventeQuestion) => {
    const current = state.activeGame;
    if (!current || current.gameData.type !== 'vrai-ou-invente') {
      return;
    }
    state.activeGame = {
      ...current,
      status: 'question',
      gameData: {
        ...current.gameData,
        questions: [question],
        currentIndex: 0,
        isLoading: false
      }
    };
  });

  state.submitVraiInventeAnswer = jest.fn((index: number) => {
    const current = state.activeGame;
    if (!current || current.gameData.type !== 'vrai-ou-invente') {
      return;
    }
    const question = current.gameData.questions[current.gameData.currentIndex];
    if (!question) {
      return;
    }
    state.activeGame = {
      ...current,
      status: 'revealed',
      gameData: {
        ...current.gameData,
        questions: [
          {
            ...question,
            userAnswerIndex: index,
            isCorrect: question.statements[index]?.isTrue ?? false
          }
        ]
      }
    };
  });

  state.startTarotGame = jest.fn((artistId: string) => {
    const game: Game = {
      id: 'game-tarot',
      artistId,
      gameType: 'tarot-cathy',
      status: 'reading',
      gameData: {
        type: 'tarot-cathy',
        theme: null,
        cardPool: [],
        selectedCardIndices: [],
        readings: [
          { cardName: 'Le Soleil', emoji: '☀️', interpretation: 'Tu shines.', isFlipped: false }
        ],
        grandFinale: 'Verdict final de test',
        isLoading: false
      },
      startedAt: new Date().toISOString(),
      endedAt: null,
      error: null
    };
    state.activeGame = game;
    return game;
  });

  state.flipTarotCard = jest.fn((index: number) => {
    const current = state.activeGame;
    if (!current || current.gameData.type !== 'tarot-cathy') {
      return;
    }
    state.activeGame = {
      ...current,
      gameData: {
        ...current.gameData,
        readings: current.gameData.readings.map((reading: TarotReading, readingIndex: number) =>
          readingIndex === index ? { ...reading, isFlipped: true } : reading
        )
      }
    };
  });

  state.completeTarotReading = jest.fn(() => {
    const current = state.activeGame;
    if (!current) {
      return;
    }
    state.activeGame = {
      ...current,
      status: 'complete'
    };
  });

  return state as MockStoreState;
}

function renderImproHook(): ReturnType<typeof useImproChain> {
  let captured: ReturnType<typeof useImproChain> | null = null;
  function Harness(): null {
    captured = useImproChain('cathy-gauthier');
    return null;
  }
  renderToString(React.createElement(Harness));
  if (!captured) {
    throw new Error('Failed to capture useImproChain');
  }
  return captured as ReturnType<typeof useImproChain>;
}

function renderVraiHook(): ReturnType<typeof useVraiOuInvente> {
  let captured: ReturnType<typeof useVraiOuInvente> | null = null;
  function Harness(): null {
    captured = useVraiOuInvente('cathy-gauthier');
    return null;
  }
  renderToString(React.createElement(Harness));
  if (!captured) {
    throw new Error('Failed to capture useVraiOuInvente');
  }
  return captured as ReturnType<typeof useVraiOuInvente>;
}

function renderTarotHook(): ReturnType<typeof useTarotCathy> {
  let captured: ReturnType<typeof useTarotCathy> | null = null;
  function Harness(): null {
    captured = useTarotCathy('cathy-gauthier');
    return null;
  }
  renderToString(React.createElement(Harness));
  if (!captured) {
    throw new Error('Failed to capture useTarotCathy');
  }
  return captured as ReturnType<typeof useTarotCathy>;
}

describe('game hooks TTS integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreRef.current = createMockState();
  });

  it('triggers TTS on impro cathy completion', async () => {
    const hook = renderImproHook();

    await hook.startGame('Theme test');

    expect(GameService.runImproTurn).toHaveBeenCalledTimes(1);
    expect(mockSpeak).toHaveBeenCalledWith('Replique Cathy de test', expect.stringContaining('artist-turn'));
  });

  it('triggers TTS on vrai-ou-invente question and reveal explanation', async () => {
    const hook = renderVraiHook();

    await hook.startGame();
    expect(VraiInventeService.fetchQuestion).toHaveBeenCalledTimes(1);
    expect(mockSpeak).toHaveBeenCalledWith(expect.stringContaining('Premiere verite'), expect.stringContaining(':question:0'));

    mockSpeak.mockClear();
    hook.submitAnswer(2);
    expect(mockSpeak).toHaveBeenCalledWith(expect.stringContaining('La troisieme etait inventee.'), expect.stringContaining(':reveal:0'));
  });

  it('triggers TTS on tarot card flip and finale', () => {
    const state = mockStoreRef.current as MockStoreState;
    state.startTarotGame('cathy-gauthier');
    const hook = renderTarotHook();

    hook.flipCard(0);
    expect(mockSpeak).toHaveBeenCalledWith('Tu shines.', expect.stringContaining(':reading:0'));

    if (!state.activeGame || state.activeGame.gameData.type !== 'tarot-cathy') {
      throw new Error('Expected tarot game state');
    }
    state.activeGame.gameData.readings = [{ cardName: 'Le Soleil', emoji: '☀️', interpretation: 'Tu shines.', isFlipped: true }];
    mockSpeak.mockClear();
    hook.completeReading();
    expect(mockSpeak).toHaveBeenCalledWith('Verdict final de test', expect.stringContaining(':finale'));
  });
});
