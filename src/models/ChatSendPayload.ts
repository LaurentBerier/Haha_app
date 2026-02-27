import type { ClaudeImageMediaType } from '../services/claudeApiService';

export interface ChatImageAttachment {
  uri: string;
  base64: string;
  mediaType: ClaudeImageMediaType;
}

export interface ChatSendPayload {
  text: string;
  image?: ChatImageAttachment | null;
}
