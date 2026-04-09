import { API_BASE_URL, CLAUDE_PROXY_URL } from '../config/env';
import type { ImageIntent } from './imageIntentService';
import type { EmojiStyle } from '../store/slices/uiSlice';
import { useStore } from '../store/useStore';

export type ClaudeImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface ClaudeTextContentBlock {
  type: 'text';
  text: string;
}

export interface ClaudeImageContentBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: ClaudeImageMediaType;
    data: string;
  };
}

export type ClaudeContentBlock = ClaudeTextContentBlock | ClaudeImageContentBlock;

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlock[];
}

export interface ClaudeAvailableExperience {
  id: string;
  type: 'mode' | 'game';
  name: string;
  aliases?: string[];
  ctaExamples?: string[];
}

export interface ClaudeStreamParams {
  messages: ClaudeMessage[];
  artistId: string;
  modeId: string;
  language: string;
  availableExperiences?: ClaudeAvailableExperience[];
  imageIntent?: ImageIntent;
  tutorialMode?: boolean;
  emojiStyle?: EmojiStyle;
  maxTokens?: number;
  temperature?: number;
  onToken: (token: string) => void;
  onComplete: (usage: { tokensUsed: number }) => void;
  onError: (error: Error) => void;
}

interface AnthropicNonStreamResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { output_tokens?: number };
  text?: string;
  output?: string;
  tokensUsed?: number;
}

function toErrorMessage(errorPayload: unknown): string {
  if (typeof errorPayload === 'string' && errorPayload) {
    return errorPayload;
  }

  if (
    errorPayload &&
    typeof errorPayload === 'object' &&
    'error' in errorPayload &&
    errorPayload.error &&
    typeof errorPayload.error === 'object' &&
    'message' in errorPayload.error &&
    typeof errorPayload.error.message === 'string'
  ) {
    return errorPayload.error.message;
  }

  return 'API error';
}

function toErrorCode(errorPayload: unknown): string | null {
  if (
    errorPayload &&
    typeof errorPayload === 'object' &&
    'error' in errorPayload &&
    errorPayload.error &&
    typeof errorPayload.error === 'object' &&
    'code' in errorPayload.error &&
    typeof errorPayload.error.code === 'string'
  ) {
    return errorPayload.error.code;
  }

  return null;
}

function toApiError(errorPayload: unknown, status: number): Error & { code?: string; status?: number } {
  const error = new Error(toErrorMessage(errorPayload)) as Error & { code?: string; status?: number };
  const code = toErrorCode(errorPayload);
  if (code) {
    error.code = code;
  }
  error.status = status;
  return error;
}

function estimateTokens(text: string): number {
  const tokens = text.trim().split(/\s+/).filter(Boolean).length;
  return tokens > 0 ? tokens : 1;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown stream error');
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function buildClaudeProxyCandidates(): string[] {
  const candidates: string[] = [];
  const addCandidate = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized) {
      return;
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  addCandidate(CLAUDE_PROXY_URL.trim());

  const apiBase = normalizeUrl(API_BASE_URL);
  if (apiBase) {
    addCandidate(`${apiBase}/claude`);
  }

  if (typeof window !== 'undefined' && typeof window.location?.origin === 'string' && window.location.origin) {
    const origin = normalizeUrl(window.location.origin);
    if (origin) {
      addCandidate(`${origin}/api/claude`);
    }
  }

  addCandidate('/api/claude');
  return candidates;
}

function extractDataBlocks(chunk: string): { blocks: string[]; remaining: string } {
  const normalized = chunk.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const remaining = parts.pop() ?? '';
  return {
    blocks: parts.filter(Boolean),
    remaining
  };
}

function parseSseData(block: string): string | null {
  const dataLines = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (!dataLines.length) {
    return null;
  }

  return dataLines.join('\n');
}

function isReactNativeRuntime(): boolean {
  const globalWithNavigator = globalThis as { navigator?: { product?: string } };
  return globalWithNavigator.navigator?.product === 'ReactNative';
}

function extractTextFromAnthropicPayload(payload: AnthropicNonStreamResponse): string {
  if (typeof payload.text === 'string') {
    return payload.text;
  }

  if (typeof payload.output === 'string') {
    return payload.output;
  }

  if (!Array.isArray(payload.content)) {
    return '';
  }

  return payload.content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text ?? '')
    .join('');
}

function extractOutputTokens(payload: AnthropicNonStreamResponse, fullText: string): number {
  if (typeof payload.tokensUsed === 'number') {
    return payload.tokensUsed;
  }

  if (typeof payload.usage?.output_tokens === 'number') {
    return payload.usage.output_tokens;
  }

  return estimateTokens(fullText);
}

export function streamClaudeResponse(params: ClaudeStreamParams): () => void {
  const controller = new AbortController();
  let isCancelled = false;
  let hasSettled = false;
  const proxyUrlCandidates = buildClaudeProxyCandidates();

  const emitToken = (token: string): void => {
    if (isCancelled || hasSettled || !token) {
      return;
    }
    params.onToken(token);
  };

  const emitComplete = (usage: { tokensUsed: number }): void => {
    if (isCancelled || hasSettled) {
      return;
    }
    hasSettled = true;
    params.onComplete(usage);
  };

  const emitError = (error: Error): void => {
    if (isCancelled || hasSettled) {
      return;
    }
    hasSettled = true;
    params.onError(error);
  };

  const runStream = async () => {
    const {
      artistId,
      modeId,
      language,
      availableExperiences,
      imageIntent,
      tutorialMode,
      emojiStyle: emojiStyleParam,
      messages,
      maxTokens = 300,
      temperature = 0.9
    } = params;

    const resolvedEmojiStyle = emojiStyleParam ?? useStore.getState().emojiStyle ?? 'classic';

    if (proxyUrlCandidates.length === 0) {
      emitError(new Error('Missing Claude proxy URL. Set EXPO_PUBLIC_CLAUDE_PROXY_URL.'));
      return;
    }

    try {
      const shouldUseStreaming = !isReactNativeRuntime();
      const accessToken = useStore.getState().session?.accessToken;
      const requestInit: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify({
          maxTokens,
          temperature,
          stream: shouldUseStreaming,
          artistId,
          modeId,
          language,
          availableExperiences,
          imageIntent,
          tutorialMode: tutorialMode === true,
          emojiStyle: resolvedEmojiStyle,
          messages
        }),
        signal: controller.signal
      };
      let response: Response | null = null;
      let lastFetchError: Error | null = null;
      for (const proxyUrl of proxyUrlCandidates) {
        try {
          response = await fetch(proxyUrl, requestInit);
          if (response) {
            break;
          }
        } catch (error) {
          const normalized = normalizeError(error);
          if (normalized.name === 'AbortError') {
            throw normalized;
          }
          lastFetchError = normalized;
        }
      }

      if (!response) {
        throw lastFetchError ?? new Error('Failed to fetch');
      }

      if (!response.ok) {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          payload = await response.text();
        }
        emitError(toApiError(payload, response.status));
        return;
      }

      if (!shouldUseStreaming) {
        const payload = (await response.json()) as AnthropicNonStreamResponse;
        const fullText = extractTextFromAnthropicPayload(payload);
        if (fullText) {
          emitToken(fullText);
        }
        emitComplete({ tokensUsed: extractOutputTokens(payload, fullText) });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        emitError(new Error('Streaming unsupported: no response body reader'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let outputTokens: number | null = null;

      while (!isCancelled) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const { blocks, remaining } = extractDataBlocks(buffer);
        buffer = remaining;

        for (const block of blocks) {
          const data = parseSseData(block);
          if (!data || data === '[DONE]') {
            continue;
          }

          let event: unknown;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }

          if (
            event &&
            typeof event === 'object' &&
            'type' in event &&
            event.type === 'content_block_delta' &&
            'delta' in event &&
            event.delta &&
            typeof event.delta === 'object' &&
            'type' in event.delta &&
            event.delta.type === 'text_delta' &&
            'text' in event.delta &&
            typeof event.delta.text === 'string'
          ) {
            fullText += event.delta.text;
            emitToken(event.delta.text);
          }

          if (
            event &&
            typeof event === 'object' &&
            'type' in event &&
            event.type === 'message_delta' &&
            'usage' in event &&
            event.usage &&
            typeof event.usage === 'object' &&
            'output_tokens' in event.usage &&
            typeof event.usage.output_tokens === 'number'
          ) {
            outputTokens = event.usage.output_tokens;
          }
        }
      }

      if (isCancelled) {
        return;
      }

      emitComplete({ tokensUsed: outputTokens ?? estimateTokens(fullText) });
    } catch (error) {
      if (isCancelled) {
        return;
      }

      const normalized = normalizeError(error);
      if (normalized.name === 'AbortError') {
        return;
      }
      if (normalized.message === 'Failed to fetch') {
        emitError(new Error("Impossible de joindre le service IA. Vérifie la connexion réseau et réessaie."));
        return;
      }
      emitError(normalized);
    }
  };

  runStream().catch((error) => {
    if (isCancelled || hasSettled) {
      return;
    }

    const normalized = normalizeError(error);
    if (normalized.name === 'AbortError') {
      return;
    }
    emitError(normalized);
  });

  return () => {
    isCancelled = true;
    controller.abort();
  };
}
