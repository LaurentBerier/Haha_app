import type { StateCreator } from 'zustand';
import { accountTypesById } from '../../config/accountTypes';
import {
  QUOTA_THRESHOLD_ABSOLUTE_PAID_RATIO,
  QUOTA_THRESHOLD_HARD_FREE_RATIO,
  QUOTA_THRESHOLD_HAIKU_RATIO,
  QUOTA_THRESHOLD_SOFT_2_RATIO,
  QUOTA_THRESHOLD_SOFT_3_RATIO
} from '../../config/quotaThresholds';
import type { UsageQuota } from '../../models/Usage';
import type { StoreState } from '../useStore';

export type QuotaThreshold = 'normal' | 'haiku' | 'soft2' | 'soft3' | 'economy' | 'exceeded';

export interface UsageSlice {
  quota: UsageQuota;
  incrementUsage: () => void;
  isQuotaExceeded: () => boolean;
  getQuotaThreshold: (accountType?: string) => QuotaThreshold;
  isSoftCapReached: () => boolean;
  markThresholdMessageShown: (threshold: 1 | 2 | 3 | 4 | 5) => void;
  isTtsAvailable: (accountType?: string) => boolean;
  isExpensiveModeAvailable: (accountType?: string) => boolean;
  isVoiceInputBlocked: (accountType?: string) => boolean;
  setBlocked: (blocked: boolean) => void;
  resetQuota: () => void;
  hydrateQuota: (messagesUsed: number, accountType: string) => void;
  hydrateQuotaWithCap: (messagesUsed: number, messagesCap: number | null) => void;
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
      threshold1MessageShown: false,
      threshold2MessageShown: false,
      threshold3MessageShown: false,
      threshold4MessageShown: false,
      threshold5MessageShown: false,
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

function resolveThreshold(quota: UsageQuota, accountType: string): QuotaThreshold {
  const ratio = getRatio(quota);
  const normalizedAccountType = (accountType || '').toLowerCase();
  const isFree = normalizedAccountType === 'free';
  if (isFree && ratio >= QUOTA_THRESHOLD_HARD_FREE_RATIO) {
    return 'exceeded';
  }
  if (!isFree && ratio >= QUOTA_THRESHOLD_ABSOLUTE_PAID_RATIO) {
    return 'exceeded';
  }
  if (!isFree && ratio >= QUOTA_THRESHOLD_HARD_FREE_RATIO) {
    return 'economy';
  }
  if (ratio >= QUOTA_THRESHOLD_SOFT_3_RATIO) {
    return 'soft3';
  }
  if (ratio >= QUOTA_THRESHOLD_SOFT_2_RATIO) {
    return 'soft2';
  }
  if (ratio >= QUOTA_THRESHOLD_HAIKU_RATIO) {
    return 'haiku';
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
    messagesCap: 200,
    messagesUsed: 0,
    threshold1MessageShown: false,
    threshold2MessageShown: false,
    threshold3MessageShown: false,
    threshold4MessageShown: false,
    threshold5MessageShown: false,
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
    const { quota, session } = get();
    const normalized = normalizeQuotaWindow(quota);
    return resolveThreshold(normalized, session?.user.accountType ?? 'free') === 'exceeded';
  },
  getQuotaThreshold: (accountType) => {
    const { quota, session } = get();
    const normalized = normalizeQuotaWindow(quota);
    return resolveThreshold(normalized, accountType ?? session?.user.accountType ?? 'free');
  },
  isSoftCapReached: () => {
    const { quota, session } = get();
    const normalized = normalizeQuotaWindow(quota);
    const threshold = resolveThreshold(normalized, session?.user.accountType ?? 'free');
    return threshold !== 'normal';
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
      if (threshold === 4) {
        return { quota: { ...normalized, threshold4MessageShown: true } };
      }
      return { quota: { ...normalized, threshold5MessageShown: true } };
    }),
  isTtsAvailable: (accountType) => {
    const normalized = normalizeQuotaWindow(get().quota);
    const threshold = resolveThreshold(normalized, accountType ?? get().session?.user.accountType ?? 'free');
    return threshold === 'normal' || threshold === 'haiku' || threshold === 'soft2';
  },
  isExpensiveModeAvailable: (accountType) => {
    const normalized = normalizeQuotaWindow(get().quota);
    const threshold = resolveThreshold(normalized, accountType ?? get().session?.user.accountType ?? 'free');
    return threshold === 'normal' || threshold === 'haiku';
  },
  isVoiceInputBlocked: (accountType) => {
    const normalized = normalizeQuotaWindow(get().quota);
    const threshold = resolveThreshold(normalized, accountType ?? get().session?.user.accountType ?? 'free');
    return threshold === 'soft3' || threshold === 'economy' || threshold === 'exceeded';
  },
  setBlocked: (blocked) =>
    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        isBlocked: blocked
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
        threshold5MessageShown: false,
        isBlocked: false,
        resetDate: computeNextResetDate(new Date())
      }
    })),
  hydrateQuota: (messagesUsed, accountType) => {
    const config = accountTypesById[accountType];
    const cap = config?.monthlyMessageCap ?? accountTypesById.free?.monthlyMessageCap ?? 200;
    const normalizedMessagesUsed =
      Number.isFinite(messagesUsed) && messagesUsed > 0 ? Math.floor(messagesUsed) : 0;
    const clampedMessagesUsed = cap === null ? normalizedMessagesUsed : Math.min(normalizedMessagesUsed, cap);
    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        messagesCap: cap,
        messagesUsed: clampedMessagesUsed,
        threshold1MessageShown: false,
        threshold2MessageShown: false,
        threshold3MessageShown: false,
        threshold4MessageShown: false,
        threshold5MessageShown: false,
        isBlocked: false
      }
    }));
  },
  hydrateQuotaWithCap: (messagesUsed, messagesCap) => {
    const cap = typeof messagesCap === 'number' && Number.isFinite(messagesCap) && messagesCap > 0 ? messagesCap : null;
    const normalizedMessagesUsed =
      Number.isFinite(messagesUsed) && messagesUsed > 0 ? Math.floor(messagesUsed) : 0;
    const clampedMessagesUsed = cap === null ? normalizedMessagesUsed : Math.min(normalizedMessagesUsed, cap);
    set((state) => ({
      quota: {
        ...normalizeQuotaWindow(state.quota),
        messagesCap: cap,
        messagesUsed: clampedMessagesUsed,
        threshold1MessageShown: false,
        threshold2MessageShown: false,
        threshold3MessageShown: false,
        threshold4MessageShown: false,
        threshold5MessageShown: false,
        isBlocked: false
      }
    }));
  },
});
