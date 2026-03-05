import type { Conversation } from '../models/Conversation';

export function findConversationById(
  conversations: Record<string, Conversation[]>,
  conversationId: string
): Conversation | null {
  if (!conversationId) {
    return null;
  }

  for (const conversationList of Object.values(conversations)) {
    const found = conversationList.find((conversation) => conversation.id === conversationId);
    if (found) {
      return found;
    }
  }

  return null;
}
