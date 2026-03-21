import { API_BASE_URL } from '../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AdminStatsPeriod = '7d' | '30d' | 'mtd';

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

export interface AdminStats {
  period: AdminStatsPeriod;
  periodStart: string;
  dailyUsage: AdminDailyUsageRow[];
  revenue: AdminRevenueRow[];
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

function getApiBase(): string {
  return (API_BASE_URL ?? '').replace(/\/+$/, '');
}

async function apiFetch<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const url = `${getApiBase()}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {})
    }
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof json?.error?.message === 'string'
        ? json.error.message
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return json as T;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getAdminStats(token: string, period: AdminStatsPeriod = 'mtd'): Promise<AdminStats> {
  return apiFetch<AdminStats>(`/api/admin-stats?period=${encodeURIComponent(period)}`, token);
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
  return apiFetch<AdminUsersPage>(`/api/admin-users${qs ? `?${qs}` : ''}`, token);
}

export async function setUserQuotaOverride(
  token: string,
  userId: string,
  monthlyCap: number | null
): Promise<void> {
  await apiFetch<unknown>('/api/admin-quota-override', token, {
    method: 'POST',
    body: JSON.stringify({ userId, monthlyCap })
  });
}

export async function setUserAccountType(
  token: string,
  userId: string,
  accountTypeId: string
): Promise<void> {
  await apiFetch<unknown>('/api/admin-account-type', token, {
    method: 'POST',
    body: JSON.stringify({ userId, accountTypeId })
  });
}
