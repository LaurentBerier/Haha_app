import { Linking } from 'react-native';
import {
  APPLE_PAY_CHECKOUT_URL,
  API_BASE_URL,
  CLAUDE_PROXY_URL,
  PAYPAL_CHECKOUT_URL,
  STRIPE_CHECKOUT_URL_REGULAR,
  STRIPE_CHECKOUT_URL_PREMIUM
} from '../config/env';
import { refreshSession } from './authService';
import { useStore } from '../store/useStore';

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
export interface SubscriptionSummary {
  accountType: string;
  provider: 'stripe' | null;
  subscriptionStatus: string | null;
  nextBillingDate: string | null;
  cancelAtPeriodEnd: boolean;
  canCancel: boolean;
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

function toBackendBaseUrl(): string {
  const explicitBase = API_BASE_URL.trim().replace(/\/+$/, '');
  if (explicitBase) {
    return explicitBase;
  }

  const proxyUrl = CLAUDE_PROXY_URL.trim();
  if (!proxyUrl) {
    return '';
  }

  if (proxyUrl.startsWith('/')) {
    return proxyUrl.replace(/\/claude\/?$/, '');
  }

  try {
    const parsed = new URL(proxyUrl);
    const normalizedPathname = parsed.pathname.replace(/\/+$/, '');
    const basePath = normalizedPathname.replace(/\/claude\/?$/, '');
    return `${parsed.protocol}//${parsed.host}${basePath}`;
  } catch {
    return '';
  }
}

function toNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

export async function fetchSubscriptionSummary(accessToken: string): Promise<SubscriptionSummary> {
  const baseUrl = toBackendBaseUrl();
  if (!baseUrl) {
    throw new Error('Missing backend API base URL. Set EXPO_PUBLIC_API_BASE_URL or EXPO_PUBLIC_CLAUDE_PROXY_URL.');
  }

  const response = await fetch(`${baseUrl}/subscription-summary`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      payload.error &&
      typeof payload.error === 'object' &&
      'message' in payload.error &&
      typeof payload.error.message === 'string'
    ) {
      throw new Error(payload.error.message);
    }
    throw new Error('Impossible de récupérer les détails de ton abonnement.');
  }

  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return {
    accountType: toNonEmptyString(record.accountType) ?? 'free',
    provider: record.provider === 'stripe' ? 'stripe' : null,
    subscriptionStatus: toNonEmptyString(record.subscriptionStatus),
    nextBillingDate: toNonEmptyString(record.nextBillingDate),
    cancelAtPeriodEnd: Boolean(record.cancelAtPeriodEnd),
    canCancel: Boolean(record.canCancel)
  };
}

export async function cancelSubscription(accessToken: string): Promise<SubscriptionSummary> {
  const baseUrl = toBackendBaseUrl();
  if (!baseUrl) {
    throw new Error('Missing backend API base URL. Set EXPO_PUBLIC_API_BASE_URL or EXPO_PUBLIC_CLAUDE_PROXY_URL.');
  }

  const response = await fetch(`${baseUrl}/subscription-cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      payload.error &&
      typeof payload.error === 'object' &&
      'message' in payload.error &&
      typeof payload.error.message === 'string'
    ) {
      throw new Error(payload.error.message);
    }
    throw new Error("Impossible d'annuler l'abonnement pour le moment.");
  }

  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return {
    accountType: toNonEmptyString(record.accountType) ?? 'free',
    provider: 'stripe',
    subscriptionStatus: toNonEmptyString(record.subscriptionStatus),
    nextBillingDate: toNonEmptyString(record.nextBillingDate),
    cancelAtPeriodEnd: Boolean(record.cancelAtPeriodEnd),
    canCancel: Boolean(record.canCancel)
  };
}

export async function syncSubscriptionState(): Promise<void> {
  const refreshedSession = await refreshSession();
  await useStore.getState().setSession(refreshedSession);
}
