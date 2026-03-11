export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';
export type MessageRole = 'user' | 'artist';

export interface MessageMetadata {
  tokensUsed?: number;
  voiceUrl?: string;
  imageUri?: string;
  imageMediaType?: string;
  errorMessage?: string;
  battleResult?: 'light' | 'solid' | 'destruction';
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  timestamp: string;
  metadata?: MessageMetadata;
}

export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
  cursor: string | null;
  messageIndexById?: Record<string, number>;
}
