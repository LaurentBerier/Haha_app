import { MODE_IDS } from '../config/constants';
import type { ChatSendPayload } from '../models/ChatSendPayload';
import type { Conversation } from '../models/Conversation';
import { normalizeConversationThreadType } from '../models/Conversation';
import { isModeSelectRoute } from '../utils/routeRestore';
import { tryLaunchExperienceFromText, type ExperienceLaunchOutcome } from './experienceLaunchService';

/**
 * Single entry for "did the user ask to launch a mode/game by text?"
 */
export function attemptExperienceLaunchBeforeSend(params: {
  artistId: string;
  text: string;
  image: unknown;
  fallbackLanguage: string;
  preferredConversationLanguage?: string;
}): ExperienceLaunchOutcome {
  const normalizedText = params.text.trim();
  if (!normalizedText || params.image) {
    return { launched: false };
  }

  return tryLaunchExperienceFromText({
    artistId: params.artistId,
    text: normalizedText,
    fallbackLanguage: params.fallbackLanguage,
    preferredConversationLanguage: params.preferredConversationLanguage
  });
}

export function resolveConversationIdForGlobalComposerSend(params: {
  pathname: string;
  artistId: string;
  conversations: Record<string, Conversation[]>;
  activeConversationId: string | null;
  /** Primary thread on mode-select with no user turns yet reuses this id. */
  hasUserMessageInConversation: (conversationId: string) => boolean;
  createConversation: (
    artistId: string,
    language: string,
    modeId: string,
    opts: { threadType: 'primary' }
  ) => { id: string };
  language: string;
}): string {
  const {
    pathname,
    artistId,
    conversations,
    activeConversationId,
    hasUserMessageInConversation,
    createConversation,
    language
  } = params;

  const isModeSelectContext = isModeSelectRoute(pathname);
  const artistConversations = conversations[artistId] ?? [];
  let conversationId: string | null = null;

  if (isModeSelectContext) {
    const activeConversation = artistConversations.find((c) => c.id === activeConversationId) ?? null;
    const activeCandidateId =
      activeConversationId &&
      activeConversation &&
      normalizeConversationThreadType(activeConversation.threadType) === 'primary'
        ? activeConversationId
        : null;

    if (activeCandidateId && !hasUserMessageInConversation(activeCandidateId)) {
      conversationId = activeCandidateId;
    }
  } else {
    conversationId =
      activeConversationId && artistConversations.some((c) => c.id === activeConversationId)
        ? activeConversationId
        : null;

    if (!conversationId && artistConversations.length > 0) {
      const [latestPrimaryConversation] = artistConversations
        .filter((c) => normalizeConversationThreadType(c.threadType) === 'primary')
        .slice()
        .sort((left, right) => {
          const rightTime = Date.parse(right.updatedAt);
          const leftTime = Date.parse(left.updatedAt);
          return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
        });
      conversationId = latestPrimaryConversation?.id ?? null;
    }
  }

  if (!conversationId) {
    conversationId = createConversation(artistId, language, MODE_IDS.ON_JASE, {
      threadType: 'primary'
    }).id;
  }

  return conversationId;
}

export type GlobalComposerSendPlan =
  | { action: 'abort' }
  | { action: 'launched' }
  | { action: 'send'; conversationId: string; nonce: string; payload: ChatSendPayload };

export function planGlobalComposerSend(params: {
  payload: ChatSendPayload;
  targetArtistId: string | null;
  pathname: string;
  language: string;
  conversations: Record<string, Conversation[]>;
  activeConversationId: string | null;
  hasUserMessageInConversation: (conversationId: string) => boolean;
  createConversation: (
    artistId: string,
    language: string,
    modeId: string,
    opts: { threadType: 'primary' }
  ) => { id: string };
}): GlobalComposerSendPlan {
  const normalizedText = params.payload.text.trim();
  const normalizedPayload: ChatSendPayload = {
    text: normalizedText,
    image: params.payload.image ?? null
  };

  if ((!normalizedText && !normalizedPayload.image) || !params.targetArtistId) {
    return { action: 'abort' };
  }

  const launchOutcome = attemptExperienceLaunchBeforeSend({
    artistId: params.targetArtistId,
    text: normalizedText,
    image: normalizedPayload.image,
    fallbackLanguage: params.language
  });

  if (launchOutcome.launched) {
    return { action: 'launched' };
  }

  const conversationId = resolveConversationIdForGlobalComposerSend({
    pathname: params.pathname,
    artistId: params.targetArtistId,
    conversations: params.conversations,
    activeConversationId: params.activeConversationId,
    hasUserMessageInConversation: params.hasUserMessageInConversation,
    createConversation: params.createConversation,
    language: params.language
  });

  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    action: 'send',
    conversationId,
    nonce,
    payload: normalizedPayload
  };
}
