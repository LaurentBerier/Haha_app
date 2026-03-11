export const SCORE_ACTIONS = {
  roast_generated: { field: 'roastsGenerated', points: 5 },
  punchline_created: { field: 'punchlinesCreated', points: 10 },
  meme_generated: { field: 'memesGenerated', points: 8 },
  battle_win: { field: 'battleWins', points: 25 },
  daily_participation: { field: 'dailyStreak', points: 5 },
  photo_roasted: { field: 'photosRoasted', points: 5 }
} as const;

export type ScoreAction = keyof typeof SCORE_ACTIONS;

export interface GamificationStats {
  score: number;
  roastsGenerated: number;
  punchlinesCreated: number;
  destructions: number;
  photosRoasted: number;
  memesGenerated: number;
  battleWins: number;
  dailyStreak: number;
  lastActiveDate: string | null;
}

export const EMPTY_GAMIFICATION_STATS: GamificationStats = {
  score: 0,
  roastsGenerated: 0,
  punchlinesCreated: 0,
  destructions: 0,
  photosRoasted: 0,
  memesGenerated: 0,
  battleWins: 0,
  dailyStreak: 0,
  lastActiveDate: null
};

export interface ScoreTitleTier {
  min: number;
  max: number;
  title: string;
}

export const SCORE_TITLE_TIERS: ScoreTitleTier[] = [
  { min: 0, max: 99, title: 'Spectateur gêné' },
  { min: 100, max: 299, title: 'Ricaneur amateur' },
  { min: 300, max: 699, title: 'Open Mic dangereux' },
  { min: 700, max: 1199, title: 'Machine à punchlines' },
  { min: 1200, max: 1999, title: 'Chauffeur de salle' },
  { min: 2000, max: 3499, title: 'Headliner' },
  { min: 3500, max: 5999, title: 'Terreur du cabaret' },
  { min: 6000, max: Number.POSITIVE_INFINITY, title: 'Légende du roast' }
];
