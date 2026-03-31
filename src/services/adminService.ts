import { API_BASE_URL, CLAUDE_PROXY_URL } from '../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AdminStatsPeriod = '7d' | '30d' | 'mtd';
export type AdminStatsGranularity = 'hour' | 'day' | 'week' | 'month';

export interface AdminDailyUsageRow {
  day: string;
  tier: string;
  endpoint: string;
  uniqueUsers: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  ttsChars: number;
}

export interface AdminRevenueRow {
  month: string;
  tier: string;
  eventType: string;
  events: number;
  totalCents: number;
}

export interface AdminTimeseriesRow {
  bucketStart: string;
  requests: number;
  uniqueUsers: number;
}

export interface AdminTierUserBreakdownRow {
  tier: string;
  users: number;
}

export interface AdminStats {
  period: AdminStatsPeriod;
  periodStart: string;
  granularity?: AdminStatsGranularity;
  dailyUsage: AdminDailyUsageRow[];
  timeseries: AdminTimeseriesRow[];
  peakRequests: number;
  userTierBreakdown: AdminTierUserBreakdownRow[];
  revenue: AdminRevenueRow[];
  estimatedClaudeCostCents: number;
  estimatedTtsCostCents: number;
  estimatedCostCents: number;
  totalRevenueCents: number;
}

export interface AdminUser {
  id: string;
  email: string | null;
  createdAt: string | null;
  tier: string | null;
  messagesThisMonth: number;
  capOverride: number | null;
  effectiveCap: number | null;
  remainingCredits: number | null;
  resetAt: string | null;
  lastActiveAt: string | null;
  totalEvents: number;
}

export interface AdminUsersPage {
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminUsersQuery {
  page?: number;
  limit?: number;
  search?: string;
  tier?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toBackendBaseUrl(): string {
  const explicitBase = API_BASE_URL.trim().replace(/\/+$/, '');
  if (explicitBase) {
    return explicitBase;
  }

  const proxyUrl = CLAUDE_PROXY_URL.trim();
  if (!proxyUrl) {
    return '';
  }

  if (proxyUrl.startsWith('/')) {
    return proxyUrl.replace(/\/claude\/?$/, '');
  }

  try {
    const parsed = new URL(proxyUrl);
    const normalizedPathname = parsed.pathname.replace(/\/+$/, '');
    const basePath = normalizedPathname.replace(/\/claude\/?$/, '');
    return `${parsed.protocol}//${parsed.host}${basePath}`;
  } catch {
    return '';
  }
}

async function apiFetch<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = toBackendBaseUrl();
  if (!baseUrl) {
    throw new Error('Missing backend API base URL. Set EXPO_PUBLIC_API_BASE_URL or EXPO_PUBLIC_CLAUDE_PROXY_URL.');
  }

  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {})
    }
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      json &&
      typeof json === 'object' &&
      'error' in json &&
      json.error &&
      typeof json.error === 'object' &&
      'message' in json.error &&
      typeof json.error.message === 'string'
        ? json.error.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (!json || typeof json !== 'object') {
    throw new Error('Invalid server response.');
  }

  return json as T;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getAdminStats(
  token: string,
  period: AdminStatsPeriod = 'mtd',
  granularity: AdminStatsGranularity = 'day'
): Promise<AdminStats> {
  return apiFetch<AdminStats>(
    `/admin-stats?period=${encodeURIComponent(period)}&granularity=${encodeURIComponent(granularity)}`,
    token
  );
}

export async function getAdminUsers(token: string, query: AdminUsersQuery = {}): Promise<AdminUsersPage> {
  const params = new URLSearchParams();
  if (typeof query.page === 'number') {
    params.set('page', String(query.page));
  }
  if (typeof query.limit === 'number') {
    params.set('limit', String(query.limit));
  }
  if (query.search) {
    params.set('search', query.search);
  }
  if (query.tier) {
    params.set('tier', query.tier);
  }

  const qs = params.toString();
  return apiFetch<AdminUsersPage>(`/admin-users${qs ? `?${qs}` : ''}`, token);
}

export async function setUserQuotaOverride(
  token: string,
  userId: string,
  monthlyCap: number | null
): Promise<void> {
  await apiFetch<unknown>('/admin-quota-override', token, {
    method: 'POST',
    body: JSON.stringify({ userId, monthlyCap })
  });
}

export async function setUserAccountType(
  token: string,
  userId: string,
  accountTypeId: string
): Promise<void> {
  await apiFetch<unknown>('/admin-account-type', token, {
    method: 'POST',
    body: JSON.stringify({ userId, accountTypeId })
  });
}

export async function resetUserMonthlyUsage(token: string, userId: string): Promise<void> {
  await apiFetch<unknown>('/admin-user-reset', token, {
    method: 'POST',
    body: JSON.stringify({ userId })
  });
}
