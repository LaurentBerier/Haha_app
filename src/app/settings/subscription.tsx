import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useToast } from '../../components/common/ToastProvider';
import { getLanguage, t } from '../../i18n';
import {
  cancelSubscription,
  fetchSubscriptionSummary,
  isCheckoutConfigured,
  startSubscriptionCheckout,
  type SubscriptionPlanId,
  type SubscriptionSummary
} from '../../services/subscriptionService';
import { impactLight, notifySuccess, notifyWarning } from '../../services/hapticsService';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';

type PlanId = 'free' | 'regular' | 'premium';

function getAccountTypeLabel(accountType: string | null | undefined): string {
  if (accountType === 'regular') {
    return t('accountTypeRegular');
  }
  if (accountType === 'premium') {
    return t('accountTypePremium');
  }
  if (accountType === 'admin') {
    return t('accountTypeAdmin');
  }
  return t('accountTypeFree');
}

function isPaidPlan(accountType: string | null | undefined): boolean {
  return accountType === 'regular' || accountType === 'premium' || accountType === 'admin';
}

function toKnownPlanId(accountType: string | null | undefined): PlanId | null {
  if (accountType === 'free' || accountType === 'regular' || accountType === 'premium') {
    return accountType;
  }
  return null;
}

function formatBillingDate(iso: string | null): string | null {
  if (!iso) {
    return null;
  }

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleDateString(getLanguage(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

export default function SubscriptionScreen() {
  const session = useStore((state) => state.session);
  const user = session?.user ?? null;

  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const toast = useToast();

  const loadSummary = useCallback(async () => {
    if (!session?.accessToken) {
      setSummary(null);
      return;
    }

    setIsLoadingSummary(true);
    try {
      const nextSummary = await fetchSubscriptionSummary(session.accessToken);
      setSummary(nextSummary);
    } catch {
      setSummary(null);
    } finally {
      setIsLoadingSummary(false);
    }
  }, [session?.accessToken]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const effectiveAccountType = summary?.accountType ?? user?.accountType ?? 'free';
  const currentPlanLabel = getAccountTypeLabel(effectiveAccountType);
  const currentPlanId = toKnownPlanId(effectiveAccountType);
  const nextCycleLabel = formatBillingDate(summary?.nextBillingDate ?? null) ?? t('settingsSubscriptionNoCycle');
  const isCancellingAtPeriodEnd = Boolean(summary?.cancelAtPeriodEnd);
  const canCancel = Boolean(summary?.canCancel);

  const plans: {
    id: PlanId;
    priceLabel: string;
    punchline: string;
    perks: [string, string, string];
  }[] = [
    {
      id: 'free',
      priceLabel: t('settingsSubscriptionPlanFreePrice'),
      punchline: t('settingsSubscriptionPlanFreePunchline'),
      perks: [
        t('settingsSubscriptionPlanFreePerk1'),
        t('settingsSubscriptionPlanFreePerk2'),
        t('settingsSubscriptionPlanFreePerk3')
      ]
    },
    {
      id: 'regular',
      priceLabel: t('settingsSubscriptionPlanRegularPrice'),
      punchline: t('settingsSubscriptionPlanRegularPunchline'),
      perks: [
        t('settingsSubscriptionPlanRegularPerk1'),
        t('settingsSubscriptionPlanRegularPerk2'),
        t('settingsSubscriptionPlanRegularPerk3')
      ]
    },
    {
      id: 'premium',
      priceLabel: t('settingsSubscriptionPlanPremiumPrice'),
      punchline: t('settingsSubscriptionPlanPremiumPunchline'),
      perks: [
        t('settingsSubscriptionPlanPremiumPerk1'),
        t('settingsSubscriptionPlanPremiumPerk2'),
        t('settingsSubscriptionPlanPremiumPerk3')
      ]
    }
  ];

  const handleCancelAtPeriodEnd = async () => {
    if (!session?.accessToken) {
      return;
    }

    setActiveActionKey('cancel');
    try {
      const nextSummary = await cancelSubscription(session.accessToken);
      setSummary(nextSummary);
      void notifySuccess();
      toast.success(t('settingsSubscriptionCancelSuccessBody'));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settingsSubscriptionCancelErrorBody');
      void notifyWarning();
      toast.error(message);
    } finally {
      setActiveActionKey(null);
    }
  };

  const requestCancellation = () => {
    Alert.alert(t('settingsSubscriptionCancelTitle'), t('settingsSubscriptionCancelConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('settingsSubscriptionCancelCta'),
        style: 'destructive',
        onPress: () => {
          void handleCancelAtPeriodEnd();
        }
      }
    ]);
  };

  const handlePlanSelection = async (planId: PlanId) => {
    if (!session) {
      return;
    }

    if (planId === 'free') {
      if (canCancel) {
        requestCancellation();
        return;
      }

      void notifyWarning();
      Alert.alert(t('settingsSubscriptionNoActionTitle'), t('settingsSubscriptionNoActionBody'));
      return;
    }

    if (!isCheckoutConfigured('stripe', planId)) {
      toast.info(t('settingsSubscriptionProviderUnavailableBody'));
      return;
    }

    const actionKey = `checkout:${planId}`;
    setActiveActionKey(actionKey);
    try {
      const opened = await startSubscriptionCheckout('stripe', planId as SubscriptionPlanId, {
        userId: user?.id,
        email: user?.email
      });
      if (!opened) {
        void notifyWarning();
        toast.error(t('settingsSubscriptionCheckoutErrorBody'));
      } else {
        void impactLight();
      }
    } catch {
      void notifyWarning();
      toast.error(t('settingsSubscriptionCheckoutErrorBody'));
    } finally {
      setActiveActionKey(null);
    }
  };

  const hasStripePlansConfigured = isCheckoutConfigured('stripe', 'regular') && isCheckoutConfigured('stripe', 'premium');

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="settings-subscription-screen">
      <View style={styles.heroCard}>
        <Text style={styles.heroTitle}>{t('settingsSubscription')}</Text>
        <Text style={styles.heroLine}>{`${t('settingsCurrentSubscription')} ${currentPlanLabel}`}</Text>
        <Text style={styles.heroMeta}>{`${t('settingsSubscriptionNextCycleLabel')} ${nextCycleLabel}`}</Text>
        {isCancellingAtPeriodEnd ? <Text style={styles.cancelNotice}>{t('settingsSubscriptionCancelScheduled')}</Text> : null}

        {canCancel ? (
          <Pressable
            style={[styles.cancelButton, activeActionKey === 'cancel' ? styles.disabledButton : null]}
            onPress={requestCancellation}
            disabled={activeActionKey !== null}
            testID="subscription-cancel-cta"
          >
            {activeActionKey === 'cancel' ? (
              <ActivityIndicator color={theme.colors.textPrimary} />
            ) : (
              <Text style={styles.cancelButtonLabel}>{t('settingsSubscriptionCancelCta')}</Text>
            )}
          </Pressable>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settingsSubscriptionChooseTitle')}</Text>
        <Text style={styles.sectionHint}>{t('settingsSubscriptionChooseHint')}</Text>

        {!hasStripePlansConfigured ? <Text style={styles.configurationWarning}>{t('settingsSubscriptionMissingConfig')}</Text> : null}

        {isLoadingSummary ? (
          <View style={styles.loadingCard}>
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonLine} />
            <View style={styles.skeletonLineShort} />
          </View>
        ) : null}

        {!isLoadingSummary
          ? plans.map((plan) => {
          const isCurrentPlan = currentPlanId === plan.id && !isCancellingAtPeriodEnd;
          const isFreeDowngrade = plan.id === 'free' && isPaidPlan(effectiveAccountType);
          const checkoutMissing = plan.id !== 'free' && !isCheckoutConfigured('stripe', plan.id as SubscriptionPlanId);
          const disableForNoAction = plan.id === 'free' && !canCancel && !isFreeDowngrade;
          const isBusy = activeActionKey !== null;
          const isProcessingThisPlan = activeActionKey === `checkout:${plan.id}`;

          const disabled = isBusy || isCurrentPlan || checkoutMissing || disableForNoAction;
          const buttonLabel = isCurrentPlan
            ? t('settingsSubscriptionCurrentPlanCta')
            : isFreeDowngrade
              ? t('settingsSubscriptionDowngradeCta')
              : t('settingsSubscriptionChoosePlanCta');

          return (
            <View
              key={plan.id}
              style={[styles.planCard, isCurrentPlan ? styles.planCardCurrent : null]}
              testID={`subscription-plan-${plan.id}`}
            >
              <View style={styles.planHeader}>
                <Text style={styles.planTitle}>{getAccountTypeLabel(plan.id)}</Text>
                <Text style={styles.planPrice}>{plan.priceLabel}</Text>
              </View>

              <Text style={styles.planPunchline}>{plan.punchline}</Text>

              {plan.perks.map((perk) => (
                <Text key={`${plan.id}-${perk}`} style={styles.planPerk}>{`• ${perk}`}</Text>
              ))}

              <Pressable
                style={[styles.planCta, disabled ? styles.disabledButton : null]}
                onPress={() => {
                  void handlePlanSelection(plan.id);
                }}
                disabled={disabled}
                testID={`subscription-plan-${plan.id}-cta`}
              >
                {isProcessingThisPlan ? (
                  <ActivityIndicator color={theme.colors.textPrimary} />
                ) : (
                  <Text style={styles.planCtaLabel}>{buttonLabel}</Text>
                )}
              </Pressable>
            </View>
          );
          })
          : Array.from({ length: 3 }).map((_, index) => (
              <View key={`subscription-skeleton-${index}`} style={styles.planCard}>
                <View style={styles.planHeader}>
                  <View style={styles.skeletonPlanTitle} />
                  <View style={styles.skeletonPlanPrice} />
                </View>
                <View style={styles.skeletonLine} />
                <View style={styles.skeletonLineShort} />
                <View style={styles.skeletonCta} />
              </View>
            ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
    minHeight: '100%'
  },
  heroCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    gap: theme.spacing.xs
  },
  heroTitle: {
    color: theme.colors.textPrimary,
    fontSize: 30,
    fontWeight: '800'
  },
  heroLine: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700'
  },
  heroMeta: {
    color: theme.colors.textSecondary,
    fontSize: 14
  },
  cancelNotice: {
    color: theme.colors.accent,
    fontSize: 14,
    fontWeight: '700'
  },
  cancelButton: {
    marginTop: theme.spacing.sm,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.error,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cancelButtonLabel: {
    color: theme.colors.error,
    fontSize: 14,
    fontWeight: '700'
  },
  section: {
    gap: theme.spacing.sm
  },
  sectionTitle: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  sectionHint: {
    color: theme.colors.textMuted,
    fontSize: 12
  },
  configurationWarning: {
    color: theme.colors.error,
    fontSize: 12,
    fontWeight: '700'
  },
  loadingCard: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    padding: theme.spacing.md,
    gap: theme.spacing.xs
  },
  loadingLabel: {
    color: theme.colors.textSecondary,
    fontSize: 14
  },
  skeletonTitle: {
    width: '42%',
    height: 14,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceButton
  },
  skeletonLine: {
    width: '88%',
    height: 10,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceSunken
  },
  skeletonLineShort: {
    width: '62%',
    height: 10,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceSunken
  },
  skeletonPlanTitle: {
    width: '40%',
    height: 18,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceButton
  },
  skeletonPlanPrice: {
    width: '26%',
    height: 12,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceSunken
  },
  skeletonCta: {
    marginTop: theme.spacing.sm,
    height: 42,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceSunken
  },
  planCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.xs
  },
  planCardCurrent: {
    borderColor: theme.colors.accent
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm
  },
  planTitle: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '800'
  },
  planPrice: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '700'
  },
  planPunchline: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  },
  planPerk: {
    color: theme.colors.textSecondary,
    fontSize: 13
  },
  planCta: {
    marginTop: theme.spacing.sm,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center'
  },
  planCtaLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  },
  disabledButton: {
    opacity: 0.6
  }
});
