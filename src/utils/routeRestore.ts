export const LAST_USEFUL_ROUTE_STORAGE_KEY = 'ha-ha:last-useful-route:v1';
export const DEFAULT_ROUTE_RESTORE_MAX_AGE_MS = 5 * 60_000;

interface PersistedRouteSnapshot {
  route: string;
  ts: number;
}

function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) {
    return '/';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function isAuthRoute(pathname: string): boolean {
  return pathname === '/auth' || pathname.startsWith('/auth/') || pathname.startsWith('/(auth)');
}

export function isRouteEligibleForPersistence(pathname: string): boolean {
  if (typeof pathname !== 'string') {
    return false;
  }

  const normalized = normalizePathname(pathname);
  if (!normalized || normalized === '/') {
    return false;
  }

  if (isAuthRoute(normalized)) {
    return false;
  }

  if (normalized === '/settings' || normalized.startsWith('/settings/') || normalized === '/stats') {
    return false;
  }

  if (normalized.startsWith('/games/')) {
    return false;
  }

  return true;
}

export function createPersistedRouteSnapshot(pathname: string, nowMs = Date.now()): PersistedRouteSnapshot | null {
  if (!isRouteEligibleForPersistence(pathname)) {
    return null;
  }

  const ts = Number.isFinite(nowMs) ? Math.max(0, Math.floor(nowMs)) : Date.now();
  return {
    route: normalizePathname(pathname),
    ts
  };
}

export function wasWebReloadNavigation(performanceApi: Pick<Performance, 'getEntriesByType'> | null | undefined): boolean {
  if (!performanceApi || typeof performanceApi.getEntriesByType !== 'function') {
    return false;
  }

  const navigationEntries = performanceApi.getEntriesByType('navigation');
  const firstEntry = Array.isArray(navigationEntries) ? navigationEntries[0] : null;
  const entryType = firstEntry && typeof firstEntry === 'object' && 'type' in firstEntry ? firstEntry.type : null;
  return entryType === 'reload';
}

function parsePersistedRouteSnapshot(rawSnapshot: string | null): PersistedRouteSnapshot | null {
  if (typeof rawSnapshot !== 'string' || !rawSnapshot.trim()) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSnapshot);
  } catch {
    return null;
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as PersistedRouteSnapshot).route !== 'string' ||
    typeof (parsed as PersistedRouteSnapshot).ts !== 'number'
  ) {
    return null;
  }

  return {
    route: normalizePathname((parsed as PersistedRouteSnapshot).route),
    ts: Math.max(0, Math.floor((parsed as PersistedRouteSnapshot).ts))
  };
}

export function resolveRouteToRestoreFromSnapshot({
  currentPathname,
  rawSnapshot,
  nowMs = Date.now(),
  maxAgeMs = DEFAULT_ROUTE_RESTORE_MAX_AGE_MS
}: {
  currentPathname: string;
  rawSnapshot: string | null;
  nowMs?: number;
  maxAgeMs?: number;
}): string | null {
  if (normalizePathname(currentPathname) !== '/') {
    return null;
  }

  const parsed = parsePersistedRouteSnapshot(rawSnapshot);
  if (!parsed) {
    return null;
  }

  if (!isRouteEligibleForPersistence(parsed.route)) {
    return null;
  }

  const safeMaxAge = Number.isFinite(maxAgeMs) ? Math.max(0, Math.floor(maxAgeMs)) : DEFAULT_ROUTE_RESTORE_MAX_AGE_MS;
  const safeNow = Number.isFinite(nowMs) ? Math.max(0, Math.floor(nowMs)) : Date.now();
  if (safeNow - parsed.ts > safeMaxAge) {
    return null;
  }

  return parsed.route;
}
