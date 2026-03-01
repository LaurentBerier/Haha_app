import type { AccountTypeId } from '../config/accountTypes';

export type SubscriptionTier = AccountTypeId;

export interface Subscription {
  tier: SubscriptionTier;
  isActive: boolean;
  renewalDate: string | null;
}
