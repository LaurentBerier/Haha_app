import {
  createPersistedRouteSnapshot,
  isRouteEligibleForPersistence,
  resolveRouteToRestoreFromSnapshot,
  wasWebReloadNavigation
} from './routeRestore';

describe('routeRestore', () => {
  it('persists only useful non-home routes', () => {
    expect(isRouteEligibleForPersistence('/')).toBe(false);
    expect(isRouteEligibleForPersistence('/(auth)/login')).toBe(false);
    expect(isRouteEligibleForPersistence('/auth/callback')).toBe(false);
    expect(isRouteEligibleForPersistence('/chat/conv-1')).toBe(true);
  });

  it('creates a snapshot with route + timestamp', () => {
    expect(createPersistedRouteSnapshot('/chat/conv-9', 12345)).toEqual({
      route: '/chat/conv-9',
      ts: 12345
    });
  });

  it('restores from home when snapshot is fresh and valid', () => {
    const rawSnapshot = JSON.stringify({
      route: '/mode-select/cathy-gauthier',
      ts: 10_000
    });

    const restored = resolveRouteToRestoreFromSnapshot({
      currentPathname: '/',
      rawSnapshot,
      nowMs: 10_200,
      maxAgeMs: 1_000
    });

    expect(restored).toBe('/mode-select/cathy-gauthier');
  });

  it('does not restore when snapshot is stale or auth route', () => {
    const staleSnapshot = JSON.stringify({
      route: '/chat/conv-stale',
      ts: 10_000
    });
    const authSnapshot = JSON.stringify({
      route: '/(auth)/login',
      ts: 10_000
    });

    expect(
      resolveRouteToRestoreFromSnapshot({
        currentPathname: '/',
        rawSnapshot: staleSnapshot,
        nowMs: 20_100,
        maxAgeMs: 5_000
      })
    ).toBeNull();

    expect(
      resolveRouteToRestoreFromSnapshot({
        currentPathname: '/',
        rawSnapshot: authSnapshot,
        nowMs: 10_100,
        maxAgeMs: 5_000
      })
    ).toBeNull();
  });

  it('detects browser reload navigation entries', () => {
    expect(
      wasWebReloadNavigation({
        getEntriesByType: () => [{ type: 'reload' } as PerformanceNavigationTiming]
      })
    ).toBe(true);

    expect(
      wasWebReloadNavigation({
        getEntriesByType: () => [{ type: 'navigate' } as PerformanceNavigationTiming]
      })
    ).toBe(false);
  });
});
