export type ConversationThreadType = 'primary' | 'secondary' | 'mode';
export const DEFAULT_CONVERSATION_THREAD_TYPE: ConversationThreadType = 'mode';

export function normalizeConversationThreadType(value: unknown): ConversationThreadType {
  if (value === 'primary' || value === 'secondary') {
    return value;
  }
  return DEFAULT_CONVERSATION_THREAD_TYPE;
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
