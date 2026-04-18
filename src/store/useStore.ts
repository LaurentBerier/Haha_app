// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('zustand') as typeof import('zustand');
import { MODE_IDS } from '../config/constants';
import { setLanguage as setI18nLanguage } from '../i18n';
import { EMPTY_GAMIFICATION_STATS } from '../models/Gamification';
import { normalizeConversationThreadType, type Conversation } from '../models/Conversation';
import type { PersistedConversation, PersistedStoreSnapshot } from '../models/Persistence';
import type { Message, MessagePage } from '../models/Message';
import { createArtistAccessSlice, type ArtistAccessSlice } from './slices/artistAccessSlice';
import { createArtistSlice, type ArtistSlice } from './slices/artistSlice';
import { createAuthSlice, type AuthSlice } from './slices/authSlice';
import { createConversationSlice, type ConversationSlice } from './slices/conversationSlice';
import { createGamificationSlice, type GamificationSlice } from './slices/gamificationSlice';
import { createGameSlice, type GameSlice } from './slices/gameSlice';
import { createMessageSlice, type MessageSlice } from './slices/messageSlice';
import { createSubscriptionSlice, type SubscriptionSlice } from './slices/subscriptionSlice';
import { createUiSlice, type UiSlice } from './slices/uiSlice';
import { createUserProfileSlice, type UserProfileSlice } from './slices/userProfileSlice';
import { createUsageSlice, type UsageSlice } from './slices/usageSlice';

export type StoreState = ArtistSlice &
  AuthSlice &
  UserProfileSlice &
  ConversationSlice &
  MessageSlice &
  SubscriptionSlice &
  ArtistAccessSlice &
  UsageSlice &
  GamificationSlice &
  GameSlice &
  UiSlice & {
    hasHydrated: boolean;
    persistedOwnerUserId: string | null;
    hydrateStore: (snapshot: PersistedStoreSnapshot) => void;
    clearAccountScopedState: () => void;
    markHydrated: () => void;
  };

function normalizeConversations(input: Record<string, PersistedConversation[]>): Record<string, Conversation[]> {
  const normalized: Record<string, Conversation[]> = {};

  Object.entries(input).forEach(([artistId, conversations]) => {
    normalized[artistId] = (conversations ?? []).map((conversation) => {
      const modeId = typeof conversation.modeId === 'string' && conversation.modeId.trim()
        ? conversation.modeId.trim()
        : MODE_IDS.ON_JASE;
      const threadType =
        conversation.threadType === undefined && modeId === MODE_IDS.ON_JASE
          ? 'primary'
          : normalizeConversationThreadType(conversation.threadType);

      return {
        ...conversation,
        modeId,
        threadType
      };
    });
  });

  return normalized;
}

function normalizeMessagesByConversation(
  input: Record<string, MessagePage | Message[]>
): Record<string, MessagePage> {
  const normalized: Record<string, MessagePage> = {};

  const isBlobVoiceUri = (value: string): boolean => value.trim().toLowerCase().startsWith('blob:');

  const sanitizeMessageVoiceMetadataForWeb = (message: Message): Message => {
    const metadata = message.metadata;
    if (!metadata) {
      return message;
    }

    const rawVoiceUrl = typeof metadata.voiceUrl === 'string' ? metadata.voiceUrl.trim() : '';
    const voiceQueue = Array.isArray(metadata.voiceQueue)
      ? metadata.voiceQueue
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter(Boolean)
          .filter((entry) => !isBlobVoiceUri(entry))
      : [];

    const hadBlobVoiceUrl = rawVoiceUrl.length > 0 && isBlobVoiceUri(rawVoiceUrl);
    const hadVoiceQueue = Array.isArray(metadata.voiceQueue) ? metadata.voiceQueue : [];
    const hadBlobQueueEntry = hadVoiceQueue.some((entry) => typeof entry === 'string' && isBlobVoiceUri(entry));

    let nextVoiceUrl = hadBlobVoiceUrl ? '' : rawVoiceUrl;
    if (!nextVoiceUrl && voiceQueue.length > 0) {
      nextVoiceUrl = voiceQueue[0] ?? '';
    }

    const didSanitize = hadBlobVoiceUrl || hadBlobQueueEntry;
    if (!didSanitize) {
      return message;
    }

    const hasReplayableVoice = nextVoiceUrl.length > 0;
    return {
      ...message,
      metadata: {
        ...metadata,
        voiceUrl: hasReplayableVoice ? nextVoiceUrl : undefined,
        voiceQueue: voiceQueue.length > 0 ? voiceQueue : undefined,
        voiceChunkBoundaries: hasReplayableVoice ? metadata.voiceChunkBoundaries : undefined,
        voiceStatus: hasReplayableVoice ? 'ready' : 'unavailable',
        voiceErrorCode: hasReplayableVoice ? undefined : 'TTS_PROVIDER_ERROR'
      }
    };
  };

  const buildMessageIndexById = (messages: Message[]): Record<string, number> => {
    const index: Record<string, number> = {};
    messages.forEach((message, position) => {
      index[message.id] = position;
    });
    return index;
  };

  Object.entries(input).forEach(([conversationId, value]) => {
    if (Array.isArray(value)) {
      const sanitizedMessages = (value as Message[]).map((message) => sanitizeMessageVoiceMetadataForWeb(message));
      normalized[conversationId] = {
        messages: sanitizedMessages,
        hasMore: false,
        cursor: null,
        messageIndexById: buildMessageIndexById(sanitizedMessages)
      };
      return;
    }

    if (value && Array.isArray(value.messages)) {
      const sanitizedMessages = value.messages.map((message) => sanitizeMessageVoiceMetadataForWeb(message));
      normalized[conversationId] = {
        messages: sanitizedMessages,
        hasMore: typeof value.hasMore === 'boolean' ? value.hasMore : false,
        cursor: typeof value.cursor === 'string' || value.cursor === null ? value.cursor : null,
        messageIndexById: buildMessageIndexById(sanitizedMessages)
      };
      return;
    }

    normalized[conversationId] = {
      messages: [],
      hasMore: false,
      cursor: null,
      messageIndexById: {}
    };
  });

  return normalized;
}

export const useStore = create<StoreState>()((...a) => ({
  ...createArtistSlice(...a),
  ...createUserProfileSlice(...a),
  ...createAuthSlice(...a),
  ...createConversationSlice(...a),
  ...createMessageSlice(...a),
  ...createSubscriptionSlice(...a),
  ...createArtistAccessSlice(...a),
  ...createUsageSlice(...a),
  ...createGamificationSlice(...a),
  ...createGameSlice(...a),
  ...createUiSlice(...a),
  hasHydrated: false,
  persistedOwnerUserId: null,
  hydrateStore: (snapshot) => {
    const current = a[1]();
    const nextLanguage = snapshot.preferences?.language === 'en-CA' ? 'en-CA' : 'fr-CA';
    const nextDisplayMode = 'dark';
    const nextReduceMotion =
      snapshot.preferences?.reduceMotion === 'on' || snapshot.preferences?.reduceMotion === 'off'
        ? snapshot.preferences.reduceMotion
        : 'system';
    const nextVoiceAutoPlay = snapshot.preferences?.voiceAutoPlay ?? true;
    const nextEmojiStyle =
      snapshot.preferences?.emojiStyle === 'off' || snapshot.preferences?.emojiStyle === 'full'
        ? snapshot.preferences.emojiStyle
        : 'classic';
    const nextConversationModeEnabled = snapshot.preferences?.conversationModeEnabled ?? current.conversationModeEnabled;

    setI18nLanguage(nextLanguage);

    a[0]({
      persistedOwnerUserId: typeof snapshot.ownerUserId === 'string' ? snapshot.ownerUserId : null,
      selectedArtistId: snapshot.selectedArtistId,
      conversations: normalizeConversations(snapshot.conversations),
      activeConversationId: snapshot.activeConversationId,
      messagesByConversation: normalizeMessagesByConversation(snapshot.messagesByConversation),
      ...EMPTY_GAMIFICATION_STATS,
      ...(snapshot.gamification ?? {}),
      language: snapshot.preferences?.language ? nextLanguage : current.language,
      displayMode: snapshot.preferences?.displayMode ? nextDisplayMode : 'dark',
      reduceMotion: snapshot.preferences?.reduceMotion ? nextReduceMotion : current.reduceMotion,
      voiceAutoPlay: snapshot.preferences ? nextVoiceAutoPlay : current.voiceAutoPlay,
      emojiStyle: snapshot.preferences ? nextEmojiStyle : current.emojiStyle,
      conversationModeEnabled: snapshot.preferences ? nextConversationModeEnabled : current.conversationModeEnabled,
      completedTutorials: snapshot.preferences?.completedTutorials ?? {},
      modeSelectSessionHubConversationByArtist: snapshot.modeSelectSessionHubConversationByArtist ?? current.modeSelectSessionHubConversationByArtist,
      greetedArtistIds: Array.isArray(snapshot.greetedArtistIds)
        ? new Set(snapshot.greetedArtistIds)
        : current.greetedArtistIds
    });
  },
  clearAccountScopedState: () =>
    a[0]({
      persistedOwnerUserId: null,
      selectedArtistId: null,
      conversations: {},
      activeConversationId: null,
      messagesByConversation: {},
      activeGame: null,
      greetedArtistIds: new Set<string>(),
      completedTutorials: {},
      queuedChatSendPayload: null,
      modeSelectSessionHubConversationByArtist: {},
      sessionExperienceEventsByArtist: {},
      ...EMPTY_GAMIFICATION_STATS
    }),
  markHydrated: () => a[0]({ hasHydrated: true })
}));

export function selectPersistedSnapshot(state: StoreState): PersistedStoreSnapshot {
  const messagesByConversation = Object.entries(state.messagesByConversation).reduce<Record<string, MessagePage>>(
    (acc, [conversationId, page]) => {
      acc[conversationId] = {
        messages: page.messages,
        hasMore: page.hasMore,
        cursor: page.cursor
      };
      return acc;
    },
    {}
  );

  return {
    ownerUserId: state.session?.user.id ?? null,
    selectedArtistId: state.selectedArtistId,
    conversations: state.conversations,
    activeConversationId: state.activeConversationId,
    messagesByConversation,
    gamification: {
      score: state.score,
      roastsGenerated: state.roastsGenerated,
      punchlinesCreated: state.punchlinesCreated,
      destructions: state.destructions,
      photosRoasted: state.photosRoasted,
      memesGenerated: state.memesGenerated,
      battleWins: state.battleWins,
      dailyStreak: state.dailyStreak,
      jokesLanded: state.jokesLanded,
      cathySurprised: state.cathySurprised,
      cathyTriggered: state.cathyTriggered,
      cathyIntrigued: state.cathyIntrigued,
      cathyApproved: state.cathyApproved,
      lastActiveDate: state.lastActiveDate
    },
    preferences: {
      language: state.language,
      displayMode: state.displayMode,
      reduceMotion: state.reduceMotion,
      voiceAutoPlay: state.voiceAutoPlay,
      emojiStyle: state.emojiStyle,
      conversationModeEnabled: state.conversationModeEnabled,
      completedTutorials: state.completedTutorials
    },
    modeSelectSessionHubConversationByArtist: state.modeSelectSessionHubConversationByArtist,
    greetedArtistIds: Array.from(state.greetedArtistIds)
  };
}
