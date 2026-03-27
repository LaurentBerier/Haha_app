export type ConversationThreadType = 'primary' | 'mode';
export const DEFAULT_CONVERSATION_THREAD_TYPE: ConversationThreadType = 'mode';

export function normalizeConversationThreadType(value: unknown): ConversationThreadType {
  return value === 'primary' ? 'primary' : DEFAULT_CONVERSATION_THREAD_TYPE;
}

export interface Conversation {
  id: string;
  userId?: string;
  artistId: string;
  title: string;
  language: string;
  modeId: string;
  threadType: ConversationThreadType;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string;
}
