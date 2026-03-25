export type GameType = 'impro-chain' | 'vrai-ou-invente' | 'tarot-cathy';

export type ImproStatus = 'active' | 'cathy-ending' | 'complete';
export type VraiInventeStatus = 'loading' | 'question' | 'revealed' | 'complete';
export type TarotCathyStatus = 'theme-select' | 'card-select' | 'loading' | 'reading' | 'complete';
export type GameStatus = ImproStatus | VraiInventeStatus | TarotCathyStatus | 'abandoned';

export interface ImproTurn {
  role: 'user' | 'artist';
  content: string;
}

export interface ImproReward {
  id: string;
  userTurnNumber: number;
  emoji: string;
  label: string;
  points: number;
}

export interface ImproChainData {
  type: 'impro-chain';
  theme: string | null;
  targetUserTurns: 3 | 4;
  userTurnsCount: number;
  turns: ImproTurn[];
  rewards: ImproReward[];
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

export interface TarotTheme {
  id: 'amour' | 'argent' | 'annee' | 'ex';
  label: string;
  emoji: string;
}

export interface TarotPoolCard {
  name: string;
  emoji: string;
}

export interface TarotReading {
  cardName: string;
  emoji: string;
  interpretation: string;
  isFlipped: boolean;
}

export interface TarotCathyData {
  type: 'tarot-cathy';
  theme: TarotTheme | null;
  cardPool: TarotPoolCard[];
  selectedCardIndices: number[];
  readings: TarotReading[];
  grandFinale: string | null;
  isLoading: boolean;
}

export type GameData = ImproChainData | VraiInventeData | TarotCathyData;

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
  labelKey: 'gameImproTitle' | 'gameVraiInventeTitle' | 'gameTarotTitle';
  descriptionKey: 'gameImproDescription' | 'gameVraiInventeDescription' | 'gameTarotDescription';
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
  },
  {
    id: 'tarot-cathy',
    labelKey: 'gameTarotTitle',
    descriptionKey: 'gameTarotDescription',
    emoji: '🔮',
    available: true
  }
];

export const TAROT_THEMES: TarotTheme[] = [
  { id: 'amour',  label: 'Mon amour',  emoji: '💕' },
  { id: 'argent', label: 'Mon argent', emoji: '💸' },
  { id: 'annee',  label: 'Mon année',  emoji: '✨' },
  { id: 'ex',     label: 'Mon ex',     emoji: '😬' },
];

export function getTarotThemeLabelKey(themeId: TarotTheme['id']): string {
  switch (themeId) {
    case 'amour':
      return 'gameTarotThemeLove';
    case 'argent':
      return 'gameTarotThemeMoney';
    case 'annee':
      return 'gameTarotThemeYear';
    case 'ex':
      return 'gameTarotThemeEx';
    default:
      return 'gameTarotTitle';
  }
}

export const TAROT_CARD_POOL: TarotPoolCard[] = [
  { name: 'Le Fou',             emoji: '🃏' },
  { name: 'La Mort',            emoji: '💀' },
  { name: 'Le Soleil',          emoji: '☀️' },
  { name: 'La Lune',            emoji: '🌙' },
  { name: 'Le Diable',          emoji: '😈' },
  { name: 'La Tour',            emoji: '🏚️' },
  { name: "L'Étoile",           emoji: '⭐' },
  { name: 'Le Monde',           emoji: '🌍' },
  { name: 'Le Jugement',        emoji: '📣' },
  { name: 'La Force',           emoji: '💪' },
  { name: "L'Amoureux",         emoji: '❤️' },
  { name: "L'Hermite",          emoji: '🧙' },
  { name: 'La Roue de Fortune', emoji: '🎡' },
  { name: 'La Justice',         emoji: '⚖️' },
  { name: 'Le Bateleur',        emoji: '🎩' },
];
