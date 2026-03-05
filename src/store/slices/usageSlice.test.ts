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
  it('increments used quota tokens', () => {
    const slice = createSliceHarness((set, get) => createUsageSlice(set as never, get as never, undefined as never));

    slice.incrementUsage(123);

    expect(slice.quota.used).toBe(123);
  });

  it('resets expired quota window when checking limits', () => {
    const slice = createSliceHarness((set, get) => createUsageSlice(set as never, get as never, undefined as never));
    slice.quota.used = 999;
    slice.quota.resetDate = new Date(Date.now() - 1000).toISOString();

    const exceeded = slice.isQuotaExceeded();

    expect(exceeded).toBe(false);
    expect(slice.quota.used).toBe(0);
    expect(Date.parse(slice.quota.resetDate)).toBeGreaterThan(Date.now());
  });
});
