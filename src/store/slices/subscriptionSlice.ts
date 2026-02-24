import type { StateCreator } from 'zustand';
import type { Subscription } from '../../models/Subscription';
import type { StoreState } from '../useStore';

export interface SubscriptionSlice {
  subscription: Subscription;
  setSubscription: (sub: Subscription) => void;
  canAccessFeature: (feature: string) => boolean;
}

const featureToTier: Record<string, Subscription['tier']> = {
  proArtist: 'pro',
  unlimited: 'core'
};

const tierRank: Record<Subscription['tier'], number> = {
  free: 0,
  core: 1,
  pro: 2
};

export const createSubscriptionSlice: StateCreator<StoreState, [], [], SubscriptionSlice> = (set, get) => ({
  subscription: {
    tier: 'free',
    isActive: true,
    renewalDate: null
  },
  setSubscription: (sub) => set({ subscription: sub }),
  canAccessFeature: (feature) => {
    const required = featureToTier[feature] ?? 'free';
    const current = get().subscription.tier;
    return tierRank[current] >= tierRank[required];
  }
});
