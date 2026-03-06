import { Linking } from 'react-native';
import { APPLE_PAY_CHECKOUT_URL, PAYPAL_CHECKOUT_URL, STRIPE_CHECKOUT_URL } from '../config/env';

export type BillingProviderId = 'stripe' | 'paypal' | 'apple';

export interface BillingProviderOption {
  id: BillingProviderId;
  checkoutUrl: string;
  isConfigured: boolean;
}

const BILLING_PROVIDER_URLS: Record<BillingProviderId, string> = {
  stripe: STRIPE_CHECKOUT_URL,
  paypal: PAYPAL_CHECKOUT_URL,
  apple: APPLE_PAY_CHECKOUT_URL
};

export function getBillingProviderOptions(): BillingProviderOption[] {
  return (Object.keys(BILLING_PROVIDER_URLS) as BillingProviderId[]).map((id) => {
    const checkoutUrl = BILLING_PROVIDER_URLS[id].trim();
    return {
      id,
      checkoutUrl,
      isConfigured: checkoutUrl.length > 0
    };
  });
}

export async function startSubscriptionCheckout(providerId: BillingProviderId): Promise<boolean> {
  const checkoutUrl = BILLING_PROVIDER_URLS[providerId]?.trim();
  if (!checkoutUrl) {
    return false;
  }

  const canOpen = await Linking.canOpenURL(checkoutUrl);
  if (!canOpen) {
    return false;
  }

  await Linking.openURL(checkoutUrl);
  return true;
}

export async function syncSubscriptionState(): Promise<void> {
  return Promise.resolve();
}
