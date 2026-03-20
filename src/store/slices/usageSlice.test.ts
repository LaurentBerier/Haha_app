import type { StoreState } from '../useStore';
import { createUsageSlice } from './usageSlice';

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

describe('usageSlice', () => {
  it('increments used quota messages by one', () => {
    const slice = createSliceHarness((set, get) => createUsageSlice(set as never, get as never, undefined as never));

    slice.incrementUsage();

    expect(slice.quota.messagesUsed).toBe(1);
  });

  it('keeps isQuotaExceeded pure when quota window is expired', () => {
    const slice = createSliceHarness((set, get) => createUsageSlice(set as never, get as never, undefined as never));
    slice.quota.messagesUsed = 999;
    slice.quota.resetDate = new Date(Date.now() - 1000).toISOString();

    const exceeded = slice.isQuotaExceeded();

    expect(exceeded).toBe(false);
    expect(slice.quota.messagesUsed).toBe(999);
  });

  it('hydrates quota with account tier cap', () => {
    const slice = createSliceHarness((set, get) => createUsageSlice(set as never, get as never, undefined as never));

    slice.hydrateQuota(42, 'regular');

    expect(slice.quota.messagesCap).toBe(3000);
    expect(slice.quota.messagesUsed).toBe(42);
  });

  it('clamps hydrated usage to the plan cap', () => {
    const slice = createSliceHarness((set, get) => createUsageSlice(set as never, get as never, undefined as never));

    slice.hydrateQuota(999, 'free');

    expect(slice.quota.messagesCap).toBe(200);
    expect(slice.quota.messagesUsed).toBe(200);
  });

  it('hydrates quota from server cap when provided', () => {
    const slice = createSliceHarness((set, get) => createUsageSlice(set as never, get as never, undefined as never));

    slice.hydrateQuotaWithCap(1500, 25000);

    expect(slice.quota.messagesCap).toBe(25000);
    expect(slice.quota.messagesUsed).toBe(1500);
  });
});
