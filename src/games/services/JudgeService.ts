import { API_BASE_URL, CLAUDE_PROXY_URL } from '../../config/env';
import type { JudgeScore } from '../types';
import { useStore } from '../../store/useStore';

interface EvaluateParams {
  artistId: string;
  round: number;
  totalRounds: number;
  userRoast: string;
  artistRoast: string;
  language: string;
}

interface JudgeResponse {
  userScore: JudgeScore;
  artistScore: JudgeScore;
}

interface ApiError extends Error {
  code?: string;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

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

function clamp(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeScore(raw: unknown): JudgeScore {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const wit = clamp(source.wit, 0, 10);
  const specificity = clamp(source.specificity, 0, 10);
  const delivery = clamp(source.delivery, 0, 10);
  const crowdReaction = clamp(source.crowdReaction, 0, 10);
  const comebackPotential = clamp(source.comebackPotential, 0, 10);
  const computedTotal = wit + specificity + delivery + crowdReaction + comebackPotential;
  const providedTotal = typeof source.total === 'number' && Number.isFinite(source.total) ? source.total : computedTotal;
  const total = clamp(providedTotal, 0, 50);
  const verdict =
    typeof source.verdict === 'string' && source.verdict.trim()
      ? source.verdict.trim().slice(0, 320)
      : 'Verdict indisponible.';

  return {
    wit,
    specificity,
    delivery,
    crowdReaction,
    comebackPotential,
    total,
    verdict
  };
}

function toError(payload: unknown, fallback: string): ApiError {
  const error = new Error(fallback) as ApiError;
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    payload.error &&
    typeof payload.error === 'object'
  ) {
    const source = payload.error as Record<string, unknown>;
    if (typeof source.message === 'string' && source.message.trim()) {
      error.message = source.message.trim();
    }
    if (typeof source.code === 'string' && source.code.trim()) {
      error.code = source.code.trim();
    }
  }
  return error;
}

function isJudgeParseError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as ApiError).code === 'JUDGE_PARSE_FAILED');
}

export class JudgeService {
  static normalizeScore(raw: unknown): JudgeScore {
    return normalizeScore(raw);
  }

  static async evaluate(params: EvaluateParams): Promise<JudgeResponse> {
    const baseUrl = toBackendBaseUrl();
    if (!baseUrl) {
      throw new Error('Missing backend API base URL.');
    }

    const accessToken = useStore.getState().session?.accessToken;
    if (!accessToken) {
      throw new Error('Unauthorized.');
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`${normalizeUrl(baseUrl)}/game-judge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({
            artistId: params.artistId,
            round: params.round,
            totalRounds: params.totalRounds,
            userRoast: params.userRoast,
            artistRoast: params.artistRoast,
            language: params.language
          })
        });

        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        if (!response.ok) {
          throw toError(payload, 'Judge unavailable.');
        }

        const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
        return {
          userScore: normalizeScore(source.userScore),
          artistScore: normalizeScore(source.artistScore)
        };
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error('Judge unavailable.');
        lastError = normalized;
        if (attempt === 0 && isJudgeParseError(normalized)) {
          continue;
        }
        break;
      }
    }

    throw lastError ?? new Error('Judge unavailable.');
  }
}
