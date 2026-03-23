import { useCallback } from 'react';
import { t } from '../i18n';

export const MIN_TTS_CHUNK_CHARS = 80;
export const MAX_TTS_CHUNK_CHARS = 360;
export const VOICE_FIRST_CHUNK_MIN_CHARS = 140;
export const NOTICE_AUDIO_SYNC_START_WAIT_MS = 1_500;
export const NOTICE_AUDIO_SYNC_FINISH_WAIT_MS = 15_000;
export const NOTICE_AUDIO_SYNC_POLL_MS = 120;

const TERMINAL_TTS_CODES = new Set(['TTS_QUOTA_EXCEEDED', 'RATE_LIMIT_EXCEEDED', 'TTS_FORBIDDEN']);

export type TerminalTtsCode = 'TTS_QUOTA_EXCEEDED' | 'RATE_LIMIT_EXCEEDED' | 'TTS_FORBIDDEN';
export type VoiceErrorCode =
  | TerminalTtsCode
  | 'UNAUTHORIZED'
  | 'TTS_PROVIDER_ERROR'
  | 'UNKNOWN';

function isTerminalTtsCode(value: string | null | undefined): value is TerminalTtsCode {
  return typeof value === 'string' && TERMINAL_TTS_CODES.has(value);
}

export function resolveTerminalTtsCode(error: unknown): TerminalTtsCode | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const code = 'code' in error && typeof error.code === 'string' ? error.code : null;
  if (isTerminalTtsCode(code)) {
    return code;
  }

  const status = 'status' in error && typeof error.status === 'number' ? error.status : null;
  if (status === 403) {
    return 'TTS_FORBIDDEN';
  }
  if (status === 429) {
    return 'RATE_LIMIT_EXCEEDED';
  }

  return null;
}

export function shouldShowUpgradeForTtsCode(code: TerminalTtsCode): boolean {
  return code === 'TTS_QUOTA_EXCEEDED' || code === 'TTS_FORBIDDEN';
}

export function buildCathyVoiceNotice(code: TerminalTtsCode): string {
  if (code === 'RATE_LIMIT_EXCEEDED') {
    return t('cathyVoiceRateLimitMessage');
  }
  return t('cathyVoiceQuotaExceededMessage');
}

export function resolveVoiceErrorCode(error: unknown): VoiceErrorCode {
  const terminalCode = resolveTerminalTtsCode(error);
  if (terminalCode) {
    return terminalCode;
  }

  if (error && typeof error === 'object') {
    const explicitCode = 'code' in error && typeof error.code === 'string' ? error.code.trim() : '';
    if (explicitCode === 'UNAUTHORIZED' || explicitCode === 'TTS_PROVIDER_ERROR') {
      return explicitCode;
    }

    const status = 'status' in error && typeof error.status === 'number' ? error.status : null;
    if (status === 401) {
      return 'UNAUTHORIZED';
    }
  }

  return 'UNKNOWN';
}

function isSentenceBoundary(input: string, index: number): boolean {
  const char = input[index];
  if (!char) {
    return false;
  }

  if (char === '\n') {
    return true;
  }

  if (char !== '.' && char !== '!' && char !== '?') {
    return false;
  }

  const next = input[index + 1];
  return next === undefined || /[\s\n]/.test(next);
}

function normalizeTtsChunk(chunk: string): string {
  return chunk.replace(/\s+/g, ' ').trim();
}

function extractReadyTtsChunks(buffer: string, flushRemainder: boolean): { chunks: string[]; remainder: string } {
  let working = buffer;
  const chunks: string[] = [];

  while (working.length > 0) {
    const searchUpperBound = Math.min(working.length, MAX_TTS_CHUNK_CHARS);
    let boundaryIndex = -1;

    for (let index = MIN_TTS_CHUNK_CHARS - 1; index < searchUpperBound; index += 1) {
      if (isSentenceBoundary(working, index)) {
        boundaryIndex = index + 1;
        break;
      }
    }

    if (boundaryIndex === -1 && working.length > MAX_TTS_CHUNK_CHARS) {
      boundaryIndex = MAX_TTS_CHUNK_CHARS;
    }

    if (boundaryIndex === -1 && flushRemainder && working.length >= MIN_TTS_CHUNK_CHARS) {
      boundaryIndex = working.length;
    }

    if (boundaryIndex === -1) {
      break;
    }

    const candidate = normalizeTtsChunk(working.slice(0, boundaryIndex));
    working = working.slice(boundaryIndex);

    if (!candidate) {
      continue;
    }

    if (candidate.length < MIN_TTS_CHUNK_CHARS) {
      if (chunks.length > 0 && chunks[chunks.length - 1]) {
        const previous = chunks[chunks.length - 1] as string;
        chunks[chunks.length - 1] = normalizeTtsChunk(`${previous} ${candidate}`);
      } else {
        working = `${candidate} ${working}`.trimStart();
        break;
      }
      continue;
    }

    chunks.push(candidate);
  }

  if (flushRemainder) {
    const normalizedRemainder = normalizeTtsChunk(working);
    if (normalizedRemainder.length >= MIN_TTS_CHUNK_CHARS) {
      chunks.push(normalizedRemainder);
      working = '';
    }
  }

  return {
    chunks,
    remainder: working
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function useTtsPlayback() {
  const normalizeChunk = useCallback((chunk: string) => normalizeTtsChunk(chunk), []);
  const extractChunks = useCallback(
    (buffer: string, flushRemainder: boolean) => extractReadyTtsChunks(buffer, flushRemainder),
    []
  );

  return {
    normalizeTtsChunk: normalizeChunk,
    extractReadyTtsChunks: extractChunks,
    resolveVoiceErrorCode
  };
}
