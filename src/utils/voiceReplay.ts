import type { Message } from '../models/Message';

export interface ReplayableArtistMessage {
  messageId: string;
  uris: string[];
}

interface FindLatestReplayableArtistMessageOptions {
  excludeMessageId?: string | null;
}

function normalizeVoiceQueue(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
}

function toReplayableArtistMessage(message: Message | null | undefined): ReplayableArtistMessage | null {
  if (!message || message.role !== 'artist' || message.status !== 'complete') {
    return null;
  }

  const voiceQueue = normalizeVoiceQueue(message.metadata?.voiceQueue);
  if (voiceQueue.length > 0) {
    return {
      messageId: message.id,
      uris: voiceQueue
    };
  }

  const voiceUrl = typeof message.metadata?.voiceUrl === 'string' ? message.metadata.voiceUrl.trim() : '';
  if (!voiceUrl) {
    return null;
  }

  return {
    messageId: message.id,
    uris: [voiceUrl]
  };
}

export function findLatestReplayableArtistMessage(
  messages: Message[],
  options?: FindLatestReplayableArtistMessageOptions
): ReplayableArtistMessage | null {
  const excludedMessageId =
    typeof options?.excludeMessageId === 'string' ? options.excludeMessageId.trim() : '';

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (excludedMessageId && message.id === excludedMessageId) {
      continue;
    }

    const replayable = toReplayableArtistMessage(message);
    if (replayable) {
      return replayable;
    }
  }

  return null;
}

export function findReplayableArtistMessageById(
  messages: Message[],
  messageId: string | null | undefined
): ReplayableArtistMessage | null {
  const normalizedMessageId = typeof messageId === 'string' ? messageId.trim() : '';
  if (!normalizedMessageId) {
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.id !== normalizedMessageId) {
      continue;
    }
    return toReplayableArtistMessage(message);
  }

  return null;
}

export function shouldReplayArtistMessage(
  lastReplayedMessageId: string | null,
  latestReplayableMessage: ReplayableArtistMessage | null
): boolean {
  return Boolean(latestReplayableMessage && latestReplayableMessage.messageId !== lastReplayedMessageId);
}
