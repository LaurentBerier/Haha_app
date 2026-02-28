import type { StateCreator } from 'zustand';
import { getAccountTypeRank } from '../../config/accountTypes';
import type { Subscription } from '../../models/Subscription';
import type { StoreState } from '../useStore';

export interface SubscriptionSlice {
  subscription: Subscription;
  setSubscription: (sub: Subscription) => void;
  canAccessFeature: (feature: string) => boolean;
}

const featureToTier: Record<string, Subscription['tier']> = {
  proArtist: 'premium',
  unlimited: 'regular',
  adminConsole: 'admin'
};

/*
 * Phase 2 migration note:
 * After Supabase auth, source of truth moves to user_profiles table.
 * Hydrate via authService post-login, then update optimistically.
 */
export const createSubscriptionSlice: StateCreator<StoreState, [], [], SubscriptionSlice> = (set, get) => ({
  subscription: {
    tier: 'free',
    isActive: true,
    renewalDate: null
  },
  setSubscription: (sub) => set({ subscription: sub }),
  canAccessFeature: (feature) => {
    const required = featureToTier[feature] ?? 'premium';
    const current = get().subscription.tier;
    return getAccountTypeRank(current) >= getAccountTypeRank(required);
  }
});
