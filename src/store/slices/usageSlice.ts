import type { StateCreator } from 'zustand';
import type { UsageQuota } from '../../models/Usage';
import type { StoreState } from '../useStore';

export interface UsageSlice {
  quota: UsageQuota;
  incrementUsage: (tokens: number) => void;
  isQuotaExceeded: () => boolean;
  resetQuota: () => void;
}

export const createUsageSlice: StateCreator<StoreState, [], [], UsageSlice> = (set, get) => ({
  quota: {
    monthlyCap: 50000,
    used: 0,
    resetDate: new Date().toISOString()
  },
  incrementUsage: (tokens) =>
    set((state) => ({
      quota: {
        ...state.quota,
        used: state.quota.used + tokens
      }
    })),
  isQuotaExceeded: () => {
    const { quota } = get();
    return quota.used >= quota.monthlyCap;
  },
  resetQuota: () =>
    set((state) => ({
      quota: {
        ...state.quota,
        used: 0,
        resetDate: new Date().toISOString()
      }
    }))
});
