import { API_BASE_URL, CLAUDE_PROXY_URL } from '../config/env';
import {
  SCORE_ACTIONS as SCORE_ACTIONS_CONFIG,
  SCORE_TITLE_TIERS,
  type GamificationStats,
  type ScoreAction
} from '../models/Gamification';
import { useStore } from '../store/useStore';

export const SCORE_ACTIONS = SCORE_ACTIONS_CONFIG;

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

function toNonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function toStats(payload: unknown): GamificationStats {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return {
    score: toNonNegativeInt(record.score),
    roastsGenerated: toNonNegativeInt(record.roastsGenerated),
    punchlinesCreated: toNonNegativeInt(record.punchlinesCreated),
    destructions: toNonNegativeInt(record.destructions),
    photosRoasted: toNonNegativeInt(record.photosRoasted),
    memesGenerated: toNonNegativeInt(record.memesGenerated),
    battleWins: toNonNegativeInt(record.battleWins),
    dailyStreak: toNonNegativeInt(record.dailyStreak),
    lastActiveDate: typeof record.lastActiveDate === 'string' ? record.lastActiveDate : null
  };
}

function toErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    payload.error &&
    typeof payload.error === 'object' &&
    'message' in payload.error &&
    typeof payload.error.message === 'string'
  ) {
    return payload.error.message;
  }

  return fallback;
}

async function requestScoreEndpoint(path: string, init: RequestInit, fallbackMessage: string): Promise<GamificationStats> {
  const baseUrl = toBackendBaseUrl();
  if (!baseUrl) {
    throw new Error('Missing backend API base URL. Set EXPO_PUBLIC_API_BASE_URL or EXPO_PUBLIC_CLAUDE_PROXY_URL.');
  }

  const response = await fetch(`${baseUrl}${path}`, init);
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(toErrorMessage(payload, fallbackMessage));
  }

  return toStats(payload);
}

export function getUserTitle(score: number): string {
  const normalized = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
  const tier = SCORE_TITLE_TIERS.find((entry) => normalized >= entry.min && normalized <= entry.max);
  return tier?.title ?? SCORE_TITLE_TIERS[SCORE_TITLE_TIERS.length - 1]?.title ?? 'Spectateur gene';
}

export async function getUserStats(accessToken?: string): Promise<GamificationStats> {
  const token = accessToken ?? useStore.getState().session?.accessToken;
  if (!token) {
    throw new Error('Unauthorized.');
  }

  const stats = await requestScoreEndpoint(
    '/score',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    'Impossible de recuperer les statistiques.'
  );

  useStore.getState().hydrateGamification(stats);
  return stats;
}

export async function addScore(action: ScoreAction, accessToken?: string): Promise<GamificationStats> {
  const token = accessToken ?? useStore.getState().session?.accessToken;
  if (!token) {
    throw new Error('Unauthorized.');
  }

  const stats = await requestScoreEndpoint(
    '/score',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ action })
    },
    'Impossible de mettre a jour le score.'
  );

  useStore.getState().hydrateGamification(stats);
  return stats;
}
