import type { ConversationThreadType } from '../../models/Conversation';
import type { Message } from '../../models/Message';

export interface ResolveModeNudgeAutoArmDecisionParams {
  isValidConversation: boolean;
  conversationThreadType: ConversationThreadType | null | undefined;
  messages: Message[];
  conversationModeEnabled: boolean;
  hasStreaming: boolean;
  isQuotaBlocked: boolean;
  hasTypedDraft: boolean;
  isComposerDisabled: boolean;
}

export interface ModeNudgeAutoArmDecision {
  candidateModeNudgeMessageId: string | null;
  shouldAutoArm: boolean;
  consumeCandidateWithoutAutoArm: boolean;
}

const EMPTY_DECISION: ModeNudgeAutoArmDecision = {
  candidateModeNudgeMessageId: null,
  shouldAutoArm: false,
  consumeCandidateWithoutAutoArm: false
};

function findLatestModeNudgeMessageId(messages: Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }

    if (message.role !== 'artist' || message.status !== 'complete' || message.metadata?.injectedType !== 'mode_nudge') {
      continue;
    }

    const normalizedId = message.id.trim();
    if (!normalizedId) {
      continue;
    }

    return normalizedId;
  }

  return null;
}

function hasUserTurns(messages: Message[]): boolean {
  return messages.some((message) => message.role === 'user');
}

export function resolveModeNudgeAutoArmDecision(
  params: ResolveModeNudgeAutoArmDecisionParams
): ModeNudgeAutoArmDecision {
  if (!params.isValidConversation || params.conversationThreadType !== 'mode') {
    return EMPTY_DECISION;
  }

  if (hasUserTurns(params.messages)) {
    return EMPTY_DECISION;
  }

  const candidateModeNudgeMessageId = findLatestModeNudgeMessageId(params.messages);
  if (!candidateModeNudgeMessageId) {
    return EMPTY_DECISION;
  }

  if (!params.conversationModeEnabled) {
    return {
      candidateModeNudgeMessageId,
      shouldAutoArm: false,
      consumeCandidateWithoutAutoArm: true
    };
  }

  if (params.isComposerDisabled || params.hasStreaming || params.isQuotaBlocked || params.hasTypedDraft) {
    return {
      candidateModeNudgeMessageId,
      shouldAutoArm: false,
      consumeCandidateWithoutAutoArm: false
    };
  }

  return {
    candidateModeNudgeMessageId,
    shouldAutoArm: true,
    consumeCandidateWithoutAutoArm: false
  };
}
