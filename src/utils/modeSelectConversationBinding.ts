import { MODE_IDS } from '../config/constants';
import type { Conversation } from '../models/Conversation';
import type { MessagePage } from '../models/Message';
import { resolveModeSelectConversationRecoveryAction } from './modeSelectConversationRecovery';

export type ModeSelectBoundResolutionReason =
  | 'keep_bound'
  | 'active_on_jase'
  | 'latest_on_jase'
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

function isOnJaseConversation(conversation: Conversation | null | undefined): conversation is Conversation {
  if (!conversation) {
    return false;
  }
  return (conversation.modeId ?? MODE_IDS.ON_JASE) === MODE_IDS.ON_JASE;
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
  return isOnJaseConversation(conversation);
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
  if (isOnJaseConversation(activeConversation)) {
    return {
      conversationId: activeConversation.id,
      reason: 'active_on_jase'
    };
  }

  const recoveryAction = resolveModeSelectConversationRecoveryAction(params.conversationsForArtist);
  if (recoveryAction.type === 'use_existing') {
    return {
      conversationId: recoveryAction.conversationId,
      reason: 'latest_on_jase'
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
    if (!isOnJaseConversation(conversation)) {
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
