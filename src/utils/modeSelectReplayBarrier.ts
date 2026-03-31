import type { Message } from '../models/Message';
import { findLatestReplayableArtistMessage } from './voiceReplay';

export interface ModeSelectReplayBarrier {
  conversationId: string;
  messageId: string;
}

interface DeriveMessagesAfterReplayBarrierParams {
  conversationId: string;
  messages: Message[];
  barrier: ModeSelectReplayBarrier | null;
}

export function captureModeSelectReplayBarrier(
  conversationId: string,
  messages: Message[]
): ModeSelectReplayBarrier | null {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId || messages.length === 0) {
    return null;
  }

  const latestReplayable = findLatestReplayableArtistMessage(messages);
  if (!latestReplayable) {
    return null;
  }

  return {
    conversationId: normalizedConversationId,
    messageId: latestReplayable.messageId
  };
}

export function deriveMessagesAfterReplayBarrier({
  conversationId,
  messages,
  barrier
}: DeriveMessagesAfterReplayBarrierParams): Message[] {
  if (!barrier) {
    return messages;
  }

  const normalizedConversationId = conversationId.trim();
  const normalizedBarrierConversationId = barrier.conversationId.trim();
  if (!normalizedConversationId || normalizedConversationId !== normalizedBarrierConversationId) {
    return messages;
  }

  const barrierMessageId = barrier.messageId.trim();
  if (!barrierMessageId) {
    return messages;
  }

  const barrierIndex = messages.findIndex((message) => message.id === barrierMessageId);
  if (barrierIndex < 0) {
    return messages;
  }

  return messages.slice(barrierIndex + 1);
}
