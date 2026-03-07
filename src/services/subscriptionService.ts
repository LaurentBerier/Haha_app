import { Linking } from 'react-native';
import {
  APPLE_PAY_CHECKOUT_URL,
  PAYPAL_CHECKOUT_URL,
  STRIPE_CHECKOUT_URL_REGULAR,
  STRIPE_CHECKOUT_URL_PREMIUM
} from '../config/env';

export type BillingProviderId = 'stripe' | 'paypal' | 'apple';
export type SubscriptionPlanId = 'regular' | 'premium';
export interface StartCheckoutOptions {
  userId?: string;
  email?: string;
}

export interface BillingProviderOption {
  id: BillingProviderId;
  isConfigured: boolean;
}

const NON_STRIPE_PROVIDER_URLS: Record<Exclude<BillingProviderId, 'stripe'>, string> = {
  paypal: PAYPAL_CHECKOUT_URL,
  apple: APPLE_PAY_CHECKOUT_URL
};
const STRIPE_CHECKOUT_URLS: Record<SubscriptionPlanId, string> = {
  regular: STRIPE_CHECKOUT_URL_REGULAR,
  premium: STRIPE_CHECKOUT_URL_PREMIUM
};

function getCheckoutUrl(providerId: BillingProviderId, planId?: SubscriptionPlanId): string {
  if (providerId === 'stripe') {
    if (!planId) {
      return '';
    }
    return STRIPE_CHECKOUT_URLS[planId].trim();
  }

  return NON_STRIPE_PROVIDER_URLS[providerId].trim();
}

export function isCheckoutConfigured(providerId: BillingProviderId, planId?: SubscriptionPlanId): boolean {
  return getCheckoutUrl(providerId, planId).length > 0;
}

export function getBillingProviderOptions(): BillingProviderOption[] {
  const providers: BillingProviderId[] = ['stripe', 'paypal', 'apple'];

  return providers.map((id) => {
    const isConfigured =
      id === 'stripe'
        ? isCheckoutConfigured('stripe', 'regular') || isCheckoutConfigured('stripe', 'premium')
        : isCheckoutConfigured(id);
    return {
      id,
      isConfigured
    };
  });
}

function buildStripeCheckoutUrl(baseUrl: string, options?: StartCheckoutOptions): string {
  if (!baseUrl) {
    return '';
  }

  try {
    const url = new URL(baseUrl);
    if (options?.userId && !url.searchParams.has('client_reference_id')) {
      url.searchParams.set('client_reference_id', options.userId);
    }
    if (options?.email && !url.searchParams.has('prefilled_email')) {
      url.searchParams.set('prefilled_email', options.email);
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

export async function startSubscriptionCheckout(
  providerId: BillingProviderId,
  planId?: SubscriptionPlanId,
  options?: StartCheckoutOptions
): Promise<boolean> {
  const rawUrl = getCheckoutUrl(providerId, planId);
  const checkoutUrl = providerId === 'stripe' ? buildStripeCheckoutUrl(rawUrl, options) : rawUrl;
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
