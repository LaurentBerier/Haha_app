import { API_BASE_URL, CLAUDE_PROXY_URL } from '../../config/env';
import { useStore } from '../../store/useStore';
import type { VraiInventeQuestion, VraiInventeStatement } from '../types';

interface FetchQuestionParams {
  artistId: string;
  language: string;
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

function isQuestionsParseError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as ApiError).code === 'QUESTIONS_PARSE_FAILED'
  );
}

function shuffle<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = copy[index];
    const target = copy[swapIndex];
    if (current === undefined || target === undefined) {
      continue;
    }
    copy[index] = target;
    copy[swapIndex] = current;
  }
  return copy;
}

function normalizeStatements(raw: unknown): VraiInventeStatement[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const source = entry as Record<string, unknown>;
      const text = typeof source.text === 'string' ? source.text.trim() : '';
      const isTrue = source.isTrue === true || source.isTrue === false ? source.isTrue : null;
      return {
        text: text.slice(0, 220),
        isTrue
      };
    })
    .filter((entry) => Boolean(entry.text) && entry.isTrue !== null)
    .map((entry) => ({ text: entry.text, isTrue: entry.isTrue as boolean }))
    .slice(0, 3);
}

function normalizeQuestion(payload: unknown): VraiInventeQuestion {
  const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const statements = normalizeStatements(source.statements);
  if (statements.length !== 3) {
    throw new Error('Question payload is invalid.');
  }

  const falseCount = statements.filter((statement) => !statement.isTrue).length;
  if (falseCount !== 1) {
    throw new Error('Question payload must contain exactly one invented statement.');
  }

  const explanation =
    typeof source.explanation === 'string' && source.explanation.trim()
      ? source.explanation.trim().slice(0, 320)
      : 'La plus credible n etait pas vraie.';

  return {
    statements: shuffle(statements),
    explanation,
    userAnswerIndex: null,
    isCorrect: null
  };
}

export class VraiInventeService {
  static async fetchQuestion(params: FetchQuestionParams): Promise<VraiInventeQuestion> {
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
        const response = await fetch(`${normalizeUrl(baseUrl)}/game-questions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({
            artistId: params.artistId,
            gameType: 'vrai-ou-invente',
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
          throw toError(payload, 'Question service unavailable.');
        }

        return normalizeQuestion(payload);
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error('Question service unavailable.');
        lastError = normalized;
        if (attempt === 0 && isQuestionsParseError(normalized)) {
          continue;
        }
        break;
      }
    }

    throw lastError ?? new Error('Question service unavailable.');
  }
}
