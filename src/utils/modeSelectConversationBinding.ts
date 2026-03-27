import { normalizeConversationThreadType, type Conversation } from '../models/Conversation';
import type { MessagePage } from '../models/Message';
import { resolveModeSelectConversationRecoveryAction } from './modeSelectConversationRecovery';

export type ModeSelectBoundResolutionReason =
  | 'keep_bound'
  | 'active_primary'
  | 'latest_primary'
  | 'missing_context'
  | 'blocked_not_greeted';

export interface ModeSelectBoundResolution {
  conversationId: string;
  reason: ModeSelectBoundResolutionReason;
}

interface ResolveModeSelectBoundConversationParams {
  artistId: string;
  isGreetingGateSatisfied: boolean;
  boundConversationId: string;
  activeConversationId: string | null;
  conversationsForArtist: Conversation[];
}

interface FindArtistConversationForMessageParams {
  conversationsForArtist: Conversation[];
  messagesByConversation: Record<string, MessagePage>;
  messageId: string;
}

function isPrimaryConversation(conversation: Conversation | null | undefined): conversation is Conversation {
  if (!conversation) {
    return false;
  }
  return normalizeConversationThreadType(conversation.threadType) === 'primary';
}

function findConversationByIdInList(
  conversations: Conversation[],
  conversationId: string
): Conversation | null {
  if (!conversationId.trim()) {
    return null;
  }
  return conversations.find((conversation) => conversation.id === conversationId) ?? null;
}

export function isValidBoundModeSelectConversation(
  boundConversationId: string,
  conversationsForArtist: Conversation[]
): boolean {
  const conversation = findConversationByIdInList(conversationsForArtist, boundConversationId.trim());
  return isPrimaryConversation(conversation);
}

export function resolveModeSelectBoundConversationId(
  params: ResolveModeSelectBoundConversationParams
): ModeSelectBoundResolution {
  if (!params.artistId.trim()) {
    return {
      conversationId: '',
      reason: 'missing_context'
    };
  }

  const normalizedBoundId = params.boundConversationId.trim();
  if (isValidBoundModeSelectConversation(normalizedBoundId, params.conversationsForArtist)) {
    return {
      conversationId: normalizedBoundId,
      reason: 'keep_bound'
    };
  }

  if (!params.isGreetingGateSatisfied) {
    return {
      conversationId: '',
      reason: 'blocked_not_greeted'
    };
  }

  const activeConversation = findConversationByIdInList(
    params.conversationsForArtist,
    params.activeConversationId?.trim() ?? ''
  );
  if (isPrimaryConversation(activeConversation)) {
    return {
      conversationId: activeConversation.id,
      reason: 'active_primary'
    };
  }

  const recoveryAction = resolveModeSelectConversationRecoveryAction(params.conversationsForArtist);
  if (recoveryAction.type === 'use_existing') {
    return {
      conversationId: recoveryAction.conversationId,
      reason: 'latest_primary'
    };
  }

  return {
    conversationId: '',
    reason: 'missing_context'
  };
}

export function findArtistConversationIdForMessageId(
  params: FindArtistConversationForMessageParams
): string | null {
  const normalizedMessageId = params.messageId.trim();
  if (!normalizedMessageId) {
    return null;
  }

  for (const conversation of params.conversationsForArtist) {
    if (!isPrimaryConversation(conversation)) {
      continue;
    }

    const page = params.messagesByConversation[conversation.id];
    if (!page) {
      continue;
    }

    const indexedPosition = page.messageIndexById?.[normalizedMessageId];
    if (typeof indexedPosition === 'number' && indexedPosition >= 0) {
      return conversation.id;
    }

    const hasMessage = page.messages.some((message) => message.id === normalizedMessageId);
    if (hasMessage) {
      return conversation.id;
    }
  }

  return null;
}
