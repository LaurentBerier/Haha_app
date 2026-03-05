import type { StoreState } from '../useStore';
import { createSubscriptionSlice } from './subscriptionSlice';

function createSliceHarness<T>(initializer: (set: (partial: unknown) => void, get: () => StoreState) => T) {
  const state: Record<string, unknown> = {};
  const set = (partial: unknown) => {
    const next =
      typeof partial === 'function'
        ? (partial as (snapshot: Record<string, unknown>) => Record<string, unknown>)(state)
        : (partial as Record<string, unknown>);
    Object.assign(state, next);
  };
  const get = () => state as unknown as StoreState;

  Object.assign(state, initializer(set, get));
  return state as unknown as T & Record<string, unknown>;
}

describe('subscriptionSlice', () => {
  it('denies admin feature for free tier by default', () => {
    const slice = createSliceHarness((set, get) => createSubscriptionSlice(set as never, get as never, undefined as never));

    expect(slice.canAccessFeature('adminConsole')).toBe(false);
  });

  it('grants premium feature after upgrading tier', () => {
    const slice = createSliceHarness((set, get) => createSubscriptionSlice(set as never, get as never, undefined as never));

    slice.setSubscription({
      tier: 'premium',
      isActive: true,
      renewalDate: null
    });

    expect(slice.canAccessFeature('proArtist')).toBe(true);
  });

  it('uses session account type as source of truth when present', () => {
    const slice = createSliceHarness((set, get) => createSubscriptionSlice(set as never, get as never, undefined as never));

    slice.setSubscription({
      tier: 'free',
      isActive: true,
      renewalDate: null
    });
    slice.session = { user: { accountType: 'admin' } };

    expect(slice.canAccessFeature('adminConsole')).toBe(true);
  });
});
