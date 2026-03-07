import type { StateCreator } from 'zustand';
import { accountTypesById } from '../../config/accountTypes';
import type { UsageQuota } from '../../models/Usage';
import type { StoreState } from '../useStore';

export interface UsageSlice {
  quota: UsageQuota;
  incrementUsage: () => void;
  isQuotaExceeded: () => boolean;
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
    messagesCap: 15,
    messagesUsed: 0,
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
  resetQuota: () =>
    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        messagesUsed: 0,
        resetDate: computeNextResetDate(new Date())
      }
    })),
  hydrateQuota: (messagesUsed, accountType) => {
    const config = accountTypesById[accountType];
    const cap = config?.monthlyMessageCap ?? accountTypesById.free?.monthlyMessageCap ?? 15;
    const normalizedMessagesUsed =
      Number.isFinite(messagesUsed) && messagesUsed > 0 ? Math.floor(messagesUsed) : 0;

    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        messagesCap: cap,
        messagesUsed: normalizedMessagesUsed
      }
    }));
  }
});
