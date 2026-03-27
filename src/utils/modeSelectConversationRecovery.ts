import { normalizeConversationThreadType, type Conversation } from '../models/Conversation';

export type ModeSelectConversationRecoveryAction =
  | {
      type: 'use_existing';
      conversationId: string;
    }
  | {
      type: 'create_new';
    };

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortPrimaryConversationsByRecency(conversations: Conversation[]): Conversation[] {
  return conversations
    .filter((conversation) => normalizeConversationThreadType(conversation.threadType) === 'primary')
    .slice()
    .sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt));
}

export function resolveModeSelectConversationRecoveryAction(
  conversations: Conversation[]
): ModeSelectConversationRecoveryAction {
  const [latestPrimaryConversation] = sortPrimaryConversationsByRecency(conversations);
  if (latestPrimaryConversation?.id) {
    return {
      type: 'use_existing',
      conversationId: latestPrimaryConversation.id
    };
  }

  return {
    type: 'create_new'
  };
}
