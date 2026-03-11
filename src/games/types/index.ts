export type GameType = 'roast-duel';

export type GameStatus =
  | 'lobby'
  | 'coin-flip'
  | 'user-turn'
  | 'artist-streaming'
  | 'judging'
  | 'round-result'
  | 'game-over'
  | 'abandoned';

export interface JudgeScore {
  wit: number;
  specificity: number;
  delivery: number;
  crowdReaction: number;
  comebackPotential: number;
  total: number;
  verdict: string;
}

export interface RoastRound {
  roundNumber: number;
  userRoast: string;
  artistRoast: string;
  streamingContent: string;
  isStreaming: boolean;
  isJudging: boolean;
  userScore: JudgeScore | null;
  artistScore: JudgeScore | null;
  winner: 'user' | 'artist' | 'tie' | null;
}

export interface GameConfig {
  roundCount: 3 | 5 | 7;
  theme: string | null;
}

export interface Game {
  id: string;
  gameType: GameType;
  artistId: string;
  status: GameStatus;
  config: GameConfig;
  rounds: RoastRound[];
  currentRound: number;
  firstRoaster: 'user' | 'artist';
  userTotalScore: number;
  artistTotalScore: number;
  winner: 'user' | 'artist' | 'tie' | null;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
}

export interface GameTypeConfig {
  id: GameType;
  labelKey: 'gameRoastDuelTitle';
  descriptionKey: 'gameRoastDuelDescription';
  emoji: string;
  defaultRounds: number;
  available: boolean;
}

export const GAME_TYPE_CONFIGS: Record<GameType, GameTypeConfig> = {
  'roast-duel': {
    id: 'roast-duel',
    labelKey: 'gameRoastDuelTitle',
    descriptionKey: 'gameRoastDuelDescription',
    emoji: '⚔️',
    defaultRounds: 3,
    available: true
  }
};
