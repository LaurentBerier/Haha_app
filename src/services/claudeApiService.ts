import { ANTHROPIC_API_KEY, ANTHROPIC_API_VERSION, ANTHROPIC_MODEL } from '../config/env';

const API_URL = 'https://api.anthropic.com/v1/messages';

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeStreamParams {
  systemPrompt: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  temperature?: number;
  onToken: (token: string) => void;
  onComplete: (usage: { tokensUsed: number }) => void;
  onError: (error: Error) => void;
}

interface AnthropicNonStreamResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { output_tokens?: number };
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

function estimateTokens(text: string): number {
  const tokens = text.trim().split(/\s+/).filter(Boolean).length;
  return tokens > 0 ? tokens : 1;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown stream error');
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
  if (!Array.isArray(payload.content)) {
    return '';
  }

  return payload.content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text ?? '')
    .join('');
}

export function streamClaudeResponse(params: ClaudeStreamParams): () => void {
  const controller = new AbortController();
  let isCancelled = false;

  void (async () => {
    const { systemPrompt, messages, maxTokens = 300, temperature = 0.9, onToken, onComplete, onError } = params;

    if (!ANTHROPIC_API_KEY.trim()) {
      onError(new Error('Missing Anthropic API key. Set EXPO_PUBLIC_ANTHROPIC_API_KEY.'));
      return;
    }

    try {
      const shouldUseStreaming = !isReactNativeRuntime();
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_API_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: maxTokens,
          temperature,
          stream: shouldUseStreaming,
          system: systemPrompt,
          messages
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          payload = await response.text();
        }
        onError(new Error(toErrorMessage(payload)));
        return;
      }

      if (!shouldUseStreaming) {
        const payload = (await response.json()) as AnthropicNonStreamResponse;
        const fullText = extractTextFromAnthropicPayload(payload);
        if (fullText) {
          onToken(fullText);
        }
        onComplete({ tokensUsed: payload.usage?.output_tokens ?? estimateTokens(fullText) });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError(new Error('Streaming unsupported: no response body reader'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let outputTokens: number | null = null;
      let didComplete = false;

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
            onToken(event.delta.text);
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

      if (!didComplete) {
        didComplete = true;
        onComplete({ tokensUsed: outputTokens ?? estimateTokens(fullText) });
      }
    } catch (error) {
      if (isCancelled) {
        return;
      }

      const normalized = normalizeError(error);
      if (normalized.name === 'AbortError') {
        return;
      }
      onError(normalized);
    }
  })();

  return () => {
    isCancelled = true;
    controller.abort();
  };
}
