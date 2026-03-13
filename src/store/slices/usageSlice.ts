import type { StateCreator } from 'zustand';
import { accountTypesById } from '../../config/accountTypes';
import type { UsageQuota } from '../../models/Usage';
import type { StoreState } from '../useStore';

export interface UsageSlice {
  quota: UsageQuota;
  incrementUsage: () => void;
  isQuotaExceeded: () => boolean;
  isSoftCapReached: () => boolean;
  markSoftCapMessageShown: () => void;
  markHardCapMessageShown: () => void;
  resetQuota: () => void;
  hydrateQuota: (messagesUsed: number, accountType: string) => void;
}

function computeNextResetDate(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)).toISOString();
}

function normalizeQuotaWindow(quota: UsageQuota): UsageQuota {
  const parsedReset = Date.parse(quota.resetDate);
  if (!Number.isFinite(parsedReset) || Date.now() >= parsedReset) {
    return {
      ...quota,
      messagesUsed: 0,
      softCapMessageShown: false,
      hardCapMessageShown: false,
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
    messagesCap: 40,
    messagesUsed: 0,
    softCapMessageShown: false,
    hardCapMessageShown: false,
    resetDate: computeNextResetDate(new Date())
  },
  incrementUsage: () =>
    set((state) => {
      const normalized = normalizeQuotaWindow(state.quota);
      return {
        quota: {
          ...normalized,
          messagesUsed: normalized.messagesUsed + 1
        }
      };
    }),
  isQuotaExceeded: () => {
    const { quota } = get();
    const normalized = normalizeQuotaWindow(quota);
    if (normalized.messagesCap === null) {
      return false;
    }
    return normalized.messagesUsed >= normalized.messagesCap;
  },
  isSoftCapReached: () => {
    const { quota } = get();
    const normalized = normalizeQuotaWindow(quota);
    if (normalized.messagesCap === null || normalized.messagesCap <= 0) {
      return false;
    }

    const softCapThreshold = Math.max(1, Math.floor(normalized.messagesCap * 0.8));
    return normalized.messagesUsed >= softCapThreshold;
  },
  markSoftCapMessageShown: () =>
    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        softCapMessageShown: true
      }
    })),
  markHardCapMessageShown: () =>
    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        hardCapMessageShown: true
      }
    })),
  resetQuota: () =>
    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        messagesUsed: 0,
        softCapMessageShown: false,
        hardCapMessageShown: false,
        resetDate: computeNextResetDate(new Date())
      }
    })),
  hydrateQuota: (messagesUsed, accountType) => {
    const config = accountTypesById[accountType];
    const cap = config?.monthlyMessageCap ?? accountTypesById.free?.monthlyMessageCap ?? 40;
    const normalizedMessagesUsed =
      Number.isFinite(messagesUsed) && messagesUsed > 0 ? Math.floor(messagesUsed) : 0;

    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        messagesCap: cap,
        messagesUsed: normalizedMessagesUsed,
        softCapMessageShown: false,
        hardCapMessageShown: false
      }
    }));
  }
});
