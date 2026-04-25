import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { fetchAccountType } from '../services/profileService';
import {
  fetchSubscriptionSummary,
  syncSubscriptionState,
  type SubscriptionSummary
} from '../services/subscriptionService';
import { useStore } from '../store/useStore';
import { useFocusRefetch } from './useFocusRefetch';
import { isPageVisibleNow, subscribePageVisible } from './usePageVisible';

const MAX_CHECKOUT_SYNC_ATTEMPTS = 8;
const CHECKOUT_SYNC_RETRY_DELAY_MS = 3000;
const CHECKOUT_SYNC_INITIAL_DELAY_MS = 1500;

export type SubscriptionPlanId = 'free' | 'regular' | 'premium';

interface SubscriptionSyncToast {
  info: (message: string) => void;
  success: (message: string) => void;
}

interface UseSubscriptionSyncOptions {
  accessToken: string | null;
  userId: string | null;
  fallbackAccountType: string | null;
  toast: SubscriptionSyncToast;
}

export function useSubscriptionSync({
  accessToken,
  userId,
  fallbackAccountType,
  toast
}: UseSubscriptionSyncOptions) {
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const pendingCheckoutPlanRef = useRef<SubscriptionPlanId | null>(null);
  const checkoutSyncAttemptsRef = useRef(0);
  const checkoutSyncInFlightRef = useRef(false);
  const checkoutSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toKnownPlanId = useCallback((accountType: string | null | undefined): SubscriptionPlanId | null => {
    if (accountType === 'free' || accountType === 'regular' || accountType === 'premium') {
      return accountType;
    }
    return null;
  }, []);

  const clearPendingCheckoutSync = useCallback(() => {
    pendingCheckoutPlanRef.current = null;
    checkoutSyncAttemptsRef.current = 0;
    checkoutSyncInFlightRef.current = false;
    if (checkoutSyncTimerRef.current !== null) {
      clearTimeout(checkoutSyncTimerRef.current);
      checkoutSyncTimerRef.current = null;
    }
  }, []);

  const loadSummary = useCallback(async () => {
    if (!accessToken || !userId) {
      setSummary(null);
      return;
    }

    setIsLoadingSummary(true);
    try {
      const nextSummary = await fetchSubscriptionSummary(accessToken);
      const accountTypeFromProfile = await fetchAccountType(userId).catch(() => null);
      setSummary({
        ...nextSummary,
        accountType: accountTypeFromProfile ?? nextSummary.accountType
      });
    } catch (error) {
      const accountTypeFromProfile = await fetchAccountType(userId).catch(() => null);
      if (accountTypeFromProfile) {
        setSummary({
          accountType: accountTypeFromProfile,
          provider: null,
          subscriptionStatus: null,
          nextBillingDate: null,
          cancelAtPeriodEnd: false,
          canCancel: false
        });
      } else {
        setSummary(
          fallbackAccountType
            ? {
                accountType: fallbackAccountType,
                provider: null,
                subscriptionStatus: null,
                nextBillingDate: null,
                cancelAtPeriodEnd: false,
                canCancel: false
              }
            : null
        );
      }
      console.error('[subscription] Failed to load summary', error);
    } finally {
      setIsLoadingSummary(false);
    }
  }, [accessToken, fallbackAccountType, userId]);

  const syncSubscriptionAfterCheckout = useCallback(async () => {
    const pendingPlan = pendingCheckoutPlanRef.current;
    if (!pendingPlan || !accessToken) {
      return;
    }

    if (checkoutSyncInFlightRef.current) {
      return;
    }

    if (!isPageVisibleNow()) {
      return;
    }

    if (checkoutSyncAttemptsRef.current >= MAX_CHECKOUT_SYNC_ATTEMPTS) {
      clearPendingCheckoutSync();
      toast.info(t('settingsSubscriptionSyncPending'));
      return;
    }

    checkoutSyncAttemptsRef.current += 1;
    checkoutSyncInFlightRef.current = true;

    try {
      await syncSubscriptionState();
      const latestAccessToken = useStore.getState().session?.accessToken ?? accessToken;
      const refreshedSummary = await fetchSubscriptionSummary(latestAccessToken);
      setSummary(refreshedSummary);

      const refreshedPlan = toKnownPlanId(refreshedSummary.accountType);
      if (refreshedPlan === pendingPlan || refreshedSummary.accountType === 'admin') {
        clearPendingCheckoutSync();
        toast.success(t('settingsSubscriptionSyncSuccess'));
        return;
      }

      if (checkoutSyncAttemptsRef.current < MAX_CHECKOUT_SYNC_ATTEMPTS) {
        checkoutSyncTimerRef.current = setTimeout(() => {
          void syncSubscriptionAfterCheckout();
        }, CHECKOUT_SYNC_RETRY_DELAY_MS);
      }
    } catch {
      if (checkoutSyncAttemptsRef.current >= MAX_CHECKOUT_SYNC_ATTEMPTS) {
        clearPendingCheckoutSync();
      } else {
        checkoutSyncTimerRef.current = setTimeout(() => {
          void syncSubscriptionAfterCheckout();
        }, CHECKOUT_SYNC_RETRY_DELAY_MS);
      }
    } finally {
      checkoutSyncInFlightRef.current = false;
    }
  }, [accessToken, clearPendingCheckoutSync, toKnownPlanId, toast]);

  const startCheckoutSync = useCallback(
    (planId: SubscriptionPlanId) => {
      pendingCheckoutPlanRef.current = planId;
      checkoutSyncAttemptsRef.current = 0;
      if (checkoutSyncTimerRef.current !== null) {
        clearTimeout(checkoutSyncTimerRef.current);
      }
      checkoutSyncTimerRef.current = setTimeout(() => {
        void syncSubscriptionAfterCheckout();
      }, CHECKOUT_SYNC_INITIAL_DELAY_MS);
    },
    [syncSubscriptionAfterCheckout]
  );

  useFocusRefetch(
    useCallback(() => {
      void loadSummary();
      void syncSubscriptionAfterCheckout();
    }, [loadSummary, syncSubscriptionAfterCheckout])
  );

  useEffect(() => {
    const unsubscribe = subscribePageVisible((visible) => {
      if (!visible && checkoutSyncTimerRef.current !== null) {
        clearTimeout(checkoutSyncTimerRef.current);
        checkoutSyncTimerRef.current = null;
      }
    });
    return () => {
      unsubscribe();
      if (checkoutSyncTimerRef.current !== null) {
        clearTimeout(checkoutSyncTimerRef.current);
        checkoutSyncTimerRef.current = null;
      }
    };
  }, []);

  return {
    summary,
    setSummary,
    isLoadingSummary,
    clearPendingCheckoutSync,
    startCheckoutSync
  };
}
