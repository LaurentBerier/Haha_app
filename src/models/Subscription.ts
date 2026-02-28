export type SubscriptionTier = string;

export interface Subscription {
  tier: SubscriptionTier;
  isActive: boolean;
  renewalDate: string | null;
}
