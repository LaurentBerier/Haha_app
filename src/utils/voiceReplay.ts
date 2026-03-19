import type { Message } from '../models/Message';

export interface ReplayableArtistMessage {
  messageId: string;
  uris: string[];
}

function normalizeVoiceQueue(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
}

export function findLatestReplayableArtistMessage(messages: Message[]): ReplayableArtistMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'artist' || message.status !== 'complete') {
      continue;
    }

    const voiceQueue = normalizeVoiceQueue(message.metadata?.voiceQueue);
    if (voiceQueue.length > 0) {
      return {
        messageId: message.id,
        uris: voiceQueue
      };
    }

    const voiceUrl = typeof message.metadata?.voiceUrl === 'string' ? message.metadata.voiceUrl.trim() : '';
    if (voiceUrl) {
      return {
        messageId: message.id,
        uris: [voiceUrl]
      };
    }
  }

  return null;
}

export function shouldReplayArtistMessage(
  lastReplayedMessageId: string | null,
  latestReplayableMessage: ReplayableArtistMessage | null
): boolean {
  return Boolean(latestReplayableMessage && latestReplayableMessage.messageId !== lastReplayedMessageId);
}
