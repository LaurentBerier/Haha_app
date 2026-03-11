export type GameType = 'impro-chain' | 'vrai-ou-invente';

export type ImproStatus = 'active' | 'cathy-ending' | 'complete';
export type VraiInventeStatus = 'loading' | 'question' | 'revealed' | 'complete';
export type GameStatus = ImproStatus | VraiInventeStatus | 'abandoned';

export interface ImproTurn {
  role: 'user' | 'artist';
  content: string;
}

export interface ImproChainData {
  type: 'impro-chain';
  turns: ImproTurn[];
  streamingContent: string;
  isStreaming: boolean;
}

export interface VraiInventeStatement {
  text: string;
  isTrue: boolean;
}

export interface VraiInventeQuestion {
  statements: VraiInventeStatement[];
  explanation: string;
  userAnswerIndex: number | null;
  isCorrect: boolean | null;
}

export interface VraiInventeData {
  type: 'vrai-ou-invente';
  questions: VraiInventeQuestion[];
  currentIndex: number;
  score: number;
  isLoading: boolean;
}

export type GameData = ImproChainData | VraiInventeData;

export interface Game {
  id: string;
  gameType: GameType;
  artistId: string;
  status: GameStatus;
  gameData: GameData;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
}

export interface GameTypeConfig {
  id: GameType;
  labelKey: 'gameImproTitle' | 'gameVraiInventeTitle';
  descriptionKey: 'gameImproDescription' | 'gameVraiInventeDescription';
  emoji: string;
  available: boolean;
}

export const GAME_TYPE_CONFIGS: GameTypeConfig[] = [
  {
    id: 'impro-chain',
    labelKey: 'gameImproTitle',
    descriptionKey: 'gameImproDescription',
    emoji: '📖',
    available: true
  },
  {
    id: 'vrai-ou-invente',
    labelKey: 'gameVraiInventeTitle',
    descriptionKey: 'gameVraiInventeDescription',
    emoji: '🎭',
    available: true
  }
];

