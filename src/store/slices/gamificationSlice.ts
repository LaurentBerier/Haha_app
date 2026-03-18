import type { StateCreator } from 'zustand';
import {
  EMPTY_GAMIFICATION_STATS,
  SCORE_ACTIONS,
  type GamificationStats,
  type ScoreAction
} from '../../models/Gamification';
import type { StoreState } from '../useStore';

function normalizeStats(stats: Partial<GamificationStats> | null | undefined): GamificationStats {
  if (!stats) {
    return EMPTY_GAMIFICATION_STATS;
  }

  const toInt = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

  return {
    score: toInt(stats.score),
    roastsGenerated: toInt(stats.roastsGenerated),
    punchlinesCreated: toInt(stats.punchlinesCreated),
    destructions: toInt(stats.destructions),
    photosRoasted: toInt(stats.photosRoasted),
    memesGenerated: toInt(stats.memesGenerated),
    battleWins: toInt(stats.battleWins),
    dailyStreak: toInt(stats.dailyStreak),
    jokesLanded: toInt(stats.jokesLanded),
    cathySurprised: toInt(stats.cathySurprised),
    cathyTriggered: toInt(stats.cathyTriggered),
    cathyIntrigued: toInt(stats.cathyIntrigued),
    cathyApproved: toInt(stats.cathyApproved),
    lastActiveDate: typeof stats.lastActiveDate === 'string' ? stats.lastActiveDate : null
  };
}

export interface GamificationSlice extends GamificationStats {
  hydrateGamification: (stats: Partial<GamificationStats> | null | undefined) => void;
  applyScoreAction: (action: ScoreAction) => void;
  resetGamification: () => void;
}

export const createGamificationSlice: StateCreator<StoreState, [], [], GamificationSlice> = (set) => ({
  ...EMPTY_GAMIFICATION_STATS,
  hydrateGamification: (stats) => set(normalizeStats(stats)),
  applyScoreAction: (action) =>
    set((state) => {
      const config = SCORE_ACTIONS[action];
      if (!config) {
        return state;
      }

      const nextFieldValue = Math.max(0, Math.floor((state[config.field] ?? 0) + 1));
      const nextScore = Math.max(0, Math.floor(state.score + config.points));
      const patch: Partial<GamificationSlice> = {
        score: nextScore,
        [config.field]: nextFieldValue
      };

      if (action === 'battle_win') {
        patch.destructions = Math.max(0, Math.floor((state.destructions ?? 0) + 1));
      }

      if (action === 'daily_participation') {
        patch.lastActiveDate = new Date().toISOString().slice(0, 10);
      }

      return patch as GamificationSlice;
    }),
  resetGamification: () => set(EMPTY_GAMIFICATION_STATS)
});
