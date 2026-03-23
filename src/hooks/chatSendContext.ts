import type { Artist } from '../models/Artist';
import type { Conversation } from '../models/Conversation';
import type { StoreState } from '../store/useStore';
import { findConversationById } from '../utils/conversationUtils';

export type ChatSendContextBlockReason = 'missing_conversation_id' | 'missing_conversation' | 'missing_artist';

export interface ChatSendContextResolution {
  conversationId: string;
  conversation: Conversation | null;
  artist: Artist | null;
  reason: ChatSendContextBlockReason | null;
}

export function resolveChatSendContextFromState(
  state: Pick<StoreState, 'conversations' | 'artists'>,
  conversationId: string
): ChatSendContextResolution {
  const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : '';
  if (!normalizedConversationId) {
    return {
      conversationId: '',
      conversation: null,
      artist: null,
      reason: 'missing_conversation_id'
    };
  }

  const conversation = findConversationById(state.conversations, normalizedConversationId);
  if (!conversation) {
    return {
      conversationId: normalizedConversationId,
      conversation: null,
      artist: null,
      reason: 'missing_conversation'
    };
  }

  const artist = state.artists.find((candidate) => candidate.id === conversation.artistId) ?? null;
  if (!artist) {
    return {
      conversationId: normalizedConversationId,
      conversation,
      artist: null,
      reason: 'missing_artist'
    };
  }

  return {
    conversationId: normalizedConversationId,
    conversation,
    artist,
    reason: null
  };
}
