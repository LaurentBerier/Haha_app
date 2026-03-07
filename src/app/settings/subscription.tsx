import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '../../i18n';
import {
  getBillingProviderOptions,
  isCheckoutConfigured,
  startSubscriptionCheckout,
  type BillingProviderId,
  type BillingProviderOption,
  type SubscriptionPlanId
} from '../../services/subscriptionService';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';

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

export default function SubscriptionScreen() {
  const session = useStore((state) => state.session);
  const user = session?.user ?? null;
  const [activeCheckoutKey, setActiveCheckoutKey] = useState<string | null>(null);
  const accountTypeLabel = getAccountTypeLabel(user?.accountType);
  const providerOptions = useMemo(() => getBillingProviderOptions(), []);

  const getProviderLabel = (providerId: BillingProviderId): string => {
    if (providerId === 'stripe') {
      return t('settingsSubscriptionProviderStripe');
    }
    if (providerId === 'paypal') {
      return t('settingsSubscriptionProviderPayPal');
    }
    return t('settingsSubscriptionProviderApple');
  };

  const toCheckoutKey = (providerId: BillingProviderId, planId?: SubscriptionPlanId): string =>
    `${providerId}:${planId ?? 'default'}`;

  const handleProviderPress = async (provider: BillingProviderOption, planId?: SubscriptionPlanId) => {
    const checkoutKey = toCheckoutKey(provider.id, planId);
    setActiveCheckoutKey(checkoutKey);
    try {
      const opened = await startSubscriptionCheckout(provider.id, planId);
      if (!opened) {
        Alert.alert(t('settingsSubscriptionProviderUnavailableTitle'), t('settingsSubscriptionProviderUnavailableBody'));
      }
    } catch {
      Alert.alert(t('settingsSubscriptionCheckoutErrorTitle'), t('settingsSubscriptionCheckoutErrorBody'));
    } finally {
      setActiveCheckoutKey(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="settings-subscription-screen">
      <View style={styles.planCard}>
        <Text style={styles.title}>{t('settingsSubscription')}</Text>
        <Text style={styles.body}>{`${t('settingsCurrentSubscription')} ${accountTypeLabel}`}</Text>
        <Text style={styles.subtle}>{t('settingsSubscriptionComingSoon')}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settingsSubscriptionMethodsTitle')}</Text>
        <Text style={styles.sectionHint}>{t('settingsSubscriptionMethodsHint')}</Text>

        {providerOptions.map((provider) => (
          <View key={provider.id} style={styles.providerCard}>
            <View style={styles.providerHeader}>
              <Text style={styles.providerName}>{getProviderLabel(provider.id)}</Text>
              <View
                style={[styles.statusPill, provider.isConfigured ? styles.statusReady : styles.statusPending]}
                testID={`subscription-provider-${provider.id}-status`}
              >
                <Text style={styles.statusPillLabel}>
                  {provider.isConfigured ? t('settingsSubscriptionProviderReady') : t('settingsSubscriptionProviderPending')}
                </Text>
              </View>
            </View>

            {provider.id === 'stripe' ? (
              <View style={styles.planButtonsRow}>
                <Pressable
                  style={[
                    styles.providerButton,
                    activeCheckoutKey === toCheckoutKey('stripe', 'regular') ? styles.providerButtonDisabled : null,
                    !isCheckoutConfigured('stripe', 'regular') ? styles.providerButtonDisabled : null
                  ]}
                  onPress={() => void handleProviderPress(provider, 'regular')}
                  disabled={activeCheckoutKey !== null || !isCheckoutConfigured('stripe', 'regular')}
                  testID="subscription-provider-stripe-regular-cta"
                >
                  <Text style={styles.providerButtonLabel}>{`${t('accountTypeRegular')} · ${t('settingsSubscriptionConnectProvider')}`}</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.providerButton,
                    activeCheckoutKey === toCheckoutKey('stripe', 'premium') ? styles.providerButtonDisabled : null,
                    !isCheckoutConfigured('stripe', 'premium') ? styles.providerButtonDisabled : null
                  ]}
                  onPress={() => void handleProviderPress(provider, 'premium')}
                  disabled={activeCheckoutKey !== null || !isCheckoutConfigured('stripe', 'premium')}
                  testID="subscription-provider-stripe-premium-cta"
                >
                  <Text style={styles.providerButtonLabel}>{`${t('accountTypePremium')} · ${t('settingsSubscriptionConnectProvider')}`}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={[
                  styles.providerButton,
                  activeCheckoutKey === toCheckoutKey(provider.id) ? styles.providerButtonDisabled : null
                ]}
                onPress={() => void handleProviderPress(provider)}
                disabled={activeCheckoutKey !== null}
                testID={`subscription-provider-${provider.id}-cta`}
              >
                <Text style={styles.providerButtonLabel}>{t('settingsSubscriptionConnectProvider')}</Text>
              </Pressable>
            )}
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
  planCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    gap: theme.spacing.xs
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '700'
  },
  body: {
    color: theme.colors.textPrimary,
    fontSize: 16
  },
  subtle: {
    color: theme.colors.textSecondary,
    fontSize: 14
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
  providerCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm
  },
  planButtonsRow: {
    gap: theme.spacing.xs
  },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm
  },
  providerName: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
  },
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4
  },
  statusReady: {
    borderColor: theme.colors.accent
  },
  statusPending: {
    borderColor: theme.colors.border
  },
  statusPillLabel: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  providerButton: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center'
  },
  providerButtonDisabled: {
    opacity: 0.65
  },
  providerButtonLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  }
});
