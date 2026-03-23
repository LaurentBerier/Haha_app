import { MODE_IDS } from '../config/constants';
import type { Conversation } from '../models/Conversation';

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

export function sortOnJaseConversationsByRecency(conversations: Conversation[]): Conversation[] {
  return conversations
    .filter((conversation) => (conversation.modeId ?? MODE_IDS.ON_JASE) === MODE_IDS.ON_JASE)
    .slice()
    .sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt));
}

export function resolveModeSelectConversationRecoveryAction(
  conversations: Conversation[]
): ModeSelectConversationRecoveryAction {
  const [latestOnJaseConversation] = sortOnJaseConversationsByRecency(conversations);
  if (latestOnJaseConversation?.id) {
    return {
      type: 'use_existing',
      conversationId: latestOnJaseConversation.id
    };
  }

  return {
    type: 'create_new'
  };
}
