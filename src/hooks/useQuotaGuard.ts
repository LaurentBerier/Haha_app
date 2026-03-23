import { useCallback } from 'react';
import {
  QUOTA_THRESHOLD_ABSOLUTE_PAID_RATIO,
  QUOTA_THRESHOLD_HARD_FREE_RATIO,
  QUOTA_THRESHOLD_SOFT_1_RATIO,
  QUOTA_THRESHOLD_SOFT_2_RATIO
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
}

interface QuotaNotice {
  content: string;
  metadata: NonNullable<Message['metadata']>;
}

interface UseQuotaGuardOptions {
  markThresholdMessageShown: (threshold: 1 | 2 | 3 | 4) => void;
  setBlocked: (blocked: boolean) => void;
}

function isQuotaBlockedErrorCode(code: string | null): boolean {
  return (
    code === 'QUOTA_EXCEEDED_BLOCKED' ||
    code === 'QUOTA_ABSOLUTE_BLOCKED' ||
    code === 'MONTHLY_QUOTA_EXCEEDED'
  );
}

function resolveThresholdMessage(threshold: 1 | 2 | 3 | 4, accountType: string): string {
  if (threshold === 4) {
    return t('cathyThreshold4PaidMessage');
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
    } => {
      const notices: QuotaNotice[] = [];
      let shouldBlockInput = false;

      if (
        normalizedAccountType !== 'admin' &&
        typeof latestQuota.messagesCap === 'number' &&
        Number.isFinite(latestQuota.messagesCap) &&
        latestQuota.messagesCap > 0
      ) {
        const ratio = latestQuota.messagesUsed / latestQuota.messagesCap;
        let thresholdToShow: 1 | 2 | 3 | 4 | null = null;

        if (
          ratio >= QUOTA_THRESHOLD_ABSOLUTE_PAID_RATIO &&
          normalizedAccountType !== 'free' &&
          !latestQuota.threshold4MessageShown
        ) {
          thresholdToShow = 4;
        } else if (ratio >= QUOTA_THRESHOLD_HARD_FREE_RATIO && !latestQuota.threshold3MessageShown) {
          thresholdToShow = 3;
        } else if (ratio >= QUOTA_THRESHOLD_SOFT_2_RATIO && !latestQuota.threshold2MessageShown) {
          thresholdToShow = 2;
        } else if (ratio >= QUOTA_THRESHOLD_SOFT_1_RATIO && !latestQuota.threshold1MessageShown) {
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

        const shouldBlockFree = normalizedAccountType === 'free' && ratio >= QUOTA_THRESHOLD_HARD_FREE_RATIO;
        const shouldBlockPaidAbsolute =
          normalizedAccountType !== 'free' && ratio >= QUOTA_THRESHOLD_ABSOLUTE_PAID_RATIO;
        shouldBlockInput = shouldBlockFree || shouldBlockPaidAbsolute;
        if (shouldBlockInput) {
          setBlocked(true);
        }
      }

      return {
        postReplyNotices: notices,
        shouldBlockInput
      };
    },
    [markThresholdMessageShown, setBlocked]
  );

  const buildQuotaBlockedMessage = useCallback(
    (normalizedAccountType: string): string => {
      const isFreeAccount = normalizedAccountType === 'free';
      markThresholdMessageShown(isFreeAccount ? 3 : 4);
      setBlocked(true);
      return isFreeAccount ? t('cathyThreshold3FreeMessage') : t('cathyThreshold4PaidMessage');
    },
    [markThresholdMessageShown, setBlocked]
  );

  return {
    isQuotaBlockedErrorCode,
    evaluatePostReplyQuota,
    buildQuotaBlockedMessage
  };
}
