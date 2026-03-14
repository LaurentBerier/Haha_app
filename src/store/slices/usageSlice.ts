import type { StateCreator } from 'zustand';
import { accountTypesById } from '../../config/accountTypes';
import type { UsageQuota } from '../../models/Usage';
import type { StoreState } from '../useStore';

export type QuotaThreshold = 'normal' | 'soft1' | 'soft2' | 'exceeded';

export interface UsageSlice {
  quota: UsageQuota;
  incrementUsage: () => void;
  isQuotaExceeded: () => boolean;
  getQuotaThreshold: () => QuotaThreshold;
  isSoftCapReached: () => boolean;
  markThresholdMessageShown: (threshold: 1 | 2 | 3 | 4) => void;
  setBlocked: (blocked: boolean) => void;
  markSoftCapMessageShown: () => void;
  markHardCapMessageShown: () => void;
  resetQuota: () => void;
  hydrateQuota: (messagesUsed: number, accountType: string) => void;
}

const THRESHOLD_1_RATIO = 0.75;
const THRESHOLD_2_RATIO = 0.9;

function computeNextResetDate(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)).toISOString();
}

function normalizeQuotaWindow(quota: UsageQuota): UsageQuota {
  const parsedReset = Date.parse(quota.resetDate);
  if (!Number.isFinite(parsedReset) || Date.now() >= parsedReset) {
    return {
      ...quota,
      messagesUsed: 0,
      threshold1MessageShown: false,
      threshold2MessageShown: false,
      threshold3MessageShown: false,
      threshold4MessageShown: false,
      isBlocked: false,
      resetDate: computeNextResetDate(new Date())
    };
  }

  return quota;
}

function getRatio(quota: UsageQuota): number {
  if (typeof quota.messagesCap !== 'number' || !Number.isFinite(quota.messagesCap) || quota.messagesCap <= 0) {
    return 0;
  }
  return quota.messagesUsed / quota.messagesCap;
}

function resolveThreshold(quota: UsageQuota): QuotaThreshold {
  const ratio = getRatio(quota);
  if (ratio >= 1) {
    return 'exceeded';
  }
  if (ratio >= THRESHOLD_2_RATIO) {
    return 'soft2';
  }
  if (ratio >= THRESHOLD_1_RATIO) {
    return 'soft1';
  }
  return 'normal';
}

/*
 * Phase 2 migration note:
 * After Supabase auth, source of truth moves to user_profiles table.
 * Hydrate via authService post-login, then update optimistically.
 */
export const createUsageSlice: StateCreator<StoreState, [], [], UsageSlice> = (set, get) => ({
  quota: {
    messagesCap: 50,
    messagesUsed: 0,
    threshold1MessageShown: false,
    threshold2MessageShown: false,
    threshold3MessageShown: false,
    threshold4MessageShown: false,
    isBlocked: false,
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
  getQuotaThreshold: () => {
    const { quota } = get();
    const normalized = normalizeQuotaWindow(quota);
    return resolveThreshold(normalized);
  },
  isSoftCapReached: () => {
    const { quota } = get();
    const normalized = normalizeQuotaWindow(quota);
    return resolveThreshold(normalized) === 'soft1' || resolveThreshold(normalized) === 'soft2' || resolveThreshold(normalized) === 'exceeded';
  },
  markThresholdMessageShown: (threshold) =>
    set((state) => {
      const normalized = normalizeQuotaWindow(state.quota);
      if (threshold === 1) {
        return { quota: { ...normalized, threshold1MessageShown: true } };
      }
      if (threshold === 2) {
        return { quota: { ...normalized, threshold2MessageShown: true } };
      }
      if (threshold === 3) {
        return { quota: { ...normalized, threshold3MessageShown: true } };
      }
      return { quota: { ...normalized, threshold4MessageShown: true } };
    }),
  setBlocked: (blocked) =>
    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        isBlocked: blocked
      }
    })),
  // Legacy compatibility with previous naming.
  markSoftCapMessageShown: () =>
    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        threshold1MessageShown: true
      }
    })),
  // Legacy compatibility with previous naming.
  markHardCapMessageShown: () =>
    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        threshold3MessageShown: true
      }
    })),
  resetQuota: () =>
    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        messagesUsed: 0,
        threshold1MessageShown: false,
        threshold2MessageShown: false,
        threshold3MessageShown: false,
        threshold4MessageShown: false,
        isBlocked: false,
        resetDate: computeNextResetDate(new Date())
      }
    })),
  hydrateQuota: (messagesUsed, accountType) => {
    const config = accountTypesById[accountType];
    const cap = config?.monthlyMessageCap ?? accountTypesById.free?.monthlyMessageCap ?? 50;
    const normalizedMessagesUsed =
      Number.isFinite(messagesUsed) && messagesUsed > 0 ? Math.floor(messagesUsed) : 0;

    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        messagesCap: cap,
        messagesUsed: normalizedMessagesUsed,
        threshold1MessageShown: false,
        threshold2MessageShown: false,
        threshold3MessageShown: false,
        threshold4MessageShown: false,
        isBlocked: false
      }
    }));
  },
});
