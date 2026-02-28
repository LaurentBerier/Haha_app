import type { StateCreator } from 'zustand';
import type { UsageQuota } from '../../models/Usage';
import type { StoreState } from '../useStore';

export interface UsageSlice {
  quota: UsageQuota;
  incrementUsage: (tokens: number) => void;
  isQuotaExceeded: () => boolean;
  resetQuota: () => void;
}

function computeNextResetDate(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)).toISOString();
}

function normalizeQuotaWindow(quota: UsageQuota): UsageQuota {
  const parsedReset = Date.parse(quota.resetDate);
  if (!Number.isFinite(parsedReset) || Date.now() >= parsedReset) {
    return {
      ...quota,
      used: 0,
      resetDate: computeNextResetDate(new Date())
    };
  }

  return quota;
}

/*
 * Phase 2 migration note:
 * After Supabase auth, source of truth moves to user_profiles table.
 * Hydrate via authService post-login, then update optimistically.
 */
export const createUsageSlice: StateCreator<StoreState, [], [], UsageSlice> = (set, get) => ({
  quota: {
    monthlyCap: 50000,
    used: 0,
    resetDate: computeNextResetDate(new Date())
  },
  incrementUsage: (tokens) =>
    set((state) => {
      const normalized = normalizeQuotaWindow(state.quota);
      return {
        quota: {
          ...normalized,
          used: normalized.used + tokens
        }
      };
    }),
  isQuotaExceeded: () => {
    const { quota } = get();
    const normalized = normalizeQuotaWindow(quota);
    if (normalized.resetDate !== quota.resetDate || normalized.used !== quota.used) {
      set({ quota: normalized });
    }
    return normalized.used >= normalized.monthlyCap;
  },
  resetQuota: () =>
    set((state) => ({
      quota: {
        ...state.quota,
        used: 0,
        resetDate: computeNextResetDate(new Date())
      }
    }))
});
