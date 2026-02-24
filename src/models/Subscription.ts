export type SubscriptionTier = 'free' | 'core' | 'pro';

export interface Subscription {
  tier: SubscriptionTier;
  isActive: boolean;
  renewalDate: string | null;
}
