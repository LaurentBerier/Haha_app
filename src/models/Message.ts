export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';
export type MessageRole = 'user' | 'artist';

export interface MessageMetadata {
  tokensUsed?: number;
  voiceUrl?: string;
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
}
