import { useCallback } from 'react';
import {
  QUOTA_THRESHOLD_ABSOLUTE_PAID_RATIO,
  QUOTA_THRESHOLD_HARD_FREE_RATIO,
  QUOTA_THRESHOLD_HAIKU_RATIO,
  QUOTA_THRESHOLD_SOFT_2_RATIO,
  QUOTA_THRESHOLD_SOFT_3_RATIO
} from '../config/quotaThresholds';
import { t } from '../i18n';
import type { Message } from '../models/Message';

interface QuotaSnapshot {
  messagesCap: number | null;
  messagesUsed: number;
  threshold1MessageShown?: boolean;
  threshold2MessageShown?: boolean;
  threshold3MessageShown?: boolean;
  threshold4MessageShown?: boolean;
  threshold5MessageShown?: boolean;
}

interface QuotaNotice {
  content: string;
  metadata: NonNullable<Message['metadata']>;
}

interface UseQuotaGuardOptions {
  markThresholdMessageShown: (threshold: 1 | 2 | 3 | 4 | 5) => void;
  setBlocked: (blocked: boolean) => void;
}

/**
 * Identify server-side quota error codes that represent a hard chat block.
 *
 * @param {string | null} code Backend error code, when available.
 * @returns {boolean} True when the code indicates a quota hard-stop state.
 */
function isQuotaBlockedErrorCode(code: string | null): boolean {
  if (code === 'TTS_MESSAGE_QUOTA_GATED' || code === 'EXPENSIVE_MODE_QUOTA_GATED') {
    return false;
  }
  return (
    code === 'QUOTA_EXCEEDED_BLOCKED' ||
    code === 'QUOTA_ABSOLUTE_BLOCKED' ||
    code === 'MONTHLY_QUOTA_EXCEEDED'
  );
}

function resolveThresholdMessage(threshold: 1 | 2 | 3 | 4 | 5, accountType: string): string {
  if (threshold === 5) {
    return t('cathyThreshold5PaidMessage');
  }
  if (threshold === 4) {
    return accountType === 'free' ? t('cathyThreshold4FreeMessage') : t('cathyThreshold4PaidMessage');
  }
  if (threshold === 3) {
    return accountType === 'free' ? t('cathyThreshold3FreeMessage') : t('cathyThreshold3PaidMessage');
  }
  if (threshold === 2) {
    return t('cathyThreshold2Message');
  }
  return t('cathyThreshold1Message');
}

export function useQuotaGuard({ markThresholdMessageShown, setBlocked }: UseQuotaGuardOptions) {
  const evaluatePostReplyQuota = useCallback(
    (
      latestQuota: QuotaSnapshot,
      normalizedAccountType: string
    ): {
      postReplyNotices: QuotaNotice[];
      shouldBlockInput: boolean;
      isTtsAvailable: boolean;
      isExpensiveModeAvailable: boolean;
      isVoiceInputBlocked: boolean;
    } => {
      const notices: QuotaNotice[] = [];
      let shouldBlockInput = false;
      let isTtsAvailable = true;
      let isExpensiveModeAvailable = true;
      let isVoiceInputBlocked = false;

      if (
        normalizedAccountType !== 'admin' &&
        typeof latestQuota.messagesCap === 'number' &&
        Number.isFinite(latestQuota.messagesCap) &&
        latestQuota.messagesCap > 0
      ) {
        const ratio = latestQuota.messagesUsed / latestQuota.messagesCap;
        const isFree = normalizedAccountType === 'free';
        let thresholdToShow: 1 | 2 | 3 | 4 | 5 | null = null;

        if (
          !isFree &&
          ratio >= QUOTA_THRESHOLD_ABSOLUTE_PAID_RATIO &&
          !latestQuota.threshold5MessageShown
        ) {
          thresholdToShow = 5;
        } else if (
          !isFree &&
          ratio >= QUOTA_THRESHOLD_HARD_FREE_RATIO &&
          !latestQuota.threshold4MessageShown
        ) {
          thresholdToShow = 4;
        } else if (ratio >= QUOTA_THRESHOLD_SOFT_3_RATIO && !latestQuota.threshold3MessageShown) {
          thresholdToShow = 3;
        } else if (ratio >= QUOTA_THRESHOLD_SOFT_2_RATIO && !latestQuota.threshold2MessageShown) {
          thresholdToShow = 2;
        } else if (ratio >= QUOTA_THRESHOLD_HAIKU_RATIO && !latestQuota.threshold1MessageShown) {
          thresholdToShow = 1;
        }

        if (thresholdToShow !== null) {
          markThresholdMessageShown(thresholdToShow);
          notices.push({
            content: resolveThresholdMessage(thresholdToShow, normalizedAccountType),
            metadata: {
              injected: true,
              showUpgradeCta: true,
              upgradeFromTier: normalizedAccountType
            }
          });
        }

        const shouldBlockFree = isFree && ratio >= QUOTA_THRESHOLD_HARD_FREE_RATIO;
        const shouldBlockPaidAbsolute = !isFree && ratio >= QUOTA_THRESHOLD_ABSOLUTE_PAID_RATIO;
        shouldBlockInput = shouldBlockFree || shouldBlockPaidAbsolute;
        if (shouldBlockInput) {
          setBlocked(true);
        }
        isTtsAvailable = ratio < QUOTA_THRESHOLD_SOFT_3_RATIO;
        isExpensiveModeAvailable = ratio < QUOTA_THRESHOLD_SOFT_2_RATIO;
        isVoiceInputBlocked = ratio >= QUOTA_THRESHOLD_SOFT_3_RATIO;
      }

      return {
        postReplyNotices: notices,
        shouldBlockInput,
        isTtsAvailable,
        isExpensiveModeAvailable,
        isVoiceInputBlocked
      };
    },
    [markThresholdMessageShown, setBlocked]
  );

  const buildQuotaBlockedMessage = useCallback(
    (normalizedAccountType: string): string => {
      const isFreeAccount = normalizedAccountType === 'free';
      markThresholdMessageShown(isFreeAccount ? 4 : 5);
      setBlocked(true);
      return isFreeAccount ? t('cathyThreshold4FreeMessage') : t('cathyThreshold5PaidMessage');
    },
    [markThresholdMessageShown, setBlocked]
  );

  const isTtsAvailable = useCallback((latestQuota: QuotaSnapshot): boolean => {
    if (
      typeof latestQuota.messagesCap !== 'number' ||
      !Number.isFinite(latestQuota.messagesCap) ||
      latestQuota.messagesCap <= 0
    ) {
      return true;
    }
    return latestQuota.messagesUsed / latestQuota.messagesCap < QUOTA_THRESHOLD_SOFT_3_RATIO;
  }, []);

  const isExpensiveModeAvailable = useCallback((latestQuota: QuotaSnapshot): boolean => {
    if (
      typeof latestQuota.messagesCap !== 'number' ||
      !Number.isFinite(latestQuota.messagesCap) ||
      latestQuota.messagesCap <= 0
    ) {
      return true;
    }
    return latestQuota.messagesUsed / latestQuota.messagesCap < QUOTA_THRESHOLD_SOFT_2_RATIO;
  }, []);

  const isVoiceInputBlocked = useCallback((latestQuota: QuotaSnapshot): boolean => {
    if (
      typeof latestQuota.messagesCap !== 'number' ||
      !Number.isFinite(latestQuota.messagesCap) ||
      latestQuota.messagesCap <= 0
    ) {
      return false;
    }
    return latestQuota.messagesUsed / latestQuota.messagesCap >= QUOTA_THRESHOLD_SOFT_3_RATIO;
  }, []);

  return {
    isQuotaBlockedErrorCode,
    evaluatePostReplyQuota,
    buildQuotaBlockedMessage,
    isTtsAvailable,
    isExpensiveModeAvailable,
    isVoiceInputBlocked
  };
}
