/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const { create } = require('zustand') as typeof import('zustand');
import { MODE_IDS } from '../config/constants';
import { setLanguage as setI18nLanguage } from '../i18n';
import { EMPTY_GAMIFICATION_STATS } from '../models/Gamification';
import type { Conversation } from '../models/Conversation';
import type { PersistedStoreSnapshot } from '../models/Persistence';
import type { Message, MessagePage } from '../models/Message';
import { createArtistAccessSlice, type ArtistAccessSlice } from './slices/artistAccessSlice';
import { createArtistSlice, type ArtistSlice } from './slices/artistSlice';
import { createAuthSlice, type AuthSlice } from './slices/authSlice';
import { createConversationSlice, type ConversationSlice } from './slices/conversationSlice';
import { createGamificationSlice, type GamificationSlice } from './slices/gamificationSlice';
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
  UiSlice & {
    hasHydrated: boolean;
    persistedOwnerUserId: string | null;
    hydrateStore: (snapshot: PersistedStoreSnapshot) => void;
    clearAccountScopedState: () => void;
    markHydrated: () => void;
  };

function normalizeConversations(input: Record<string, Conversation[]>): Record<string, Conversation[]> {
  const normalized: Record<string, Conversation[]> = {};

  Object.entries(input).forEach(([artistId, conversations]) => {
    normalized[artistId] = (conversations ?? []).map((conversation) => ({
      ...conversation,
      modeId: conversation.modeId ?? MODE_IDS.RADAR_ATTITUDE
    }));
  });

  return normalized;
}

function normalizeMessagesByConversation(
  input: Record<string, MessagePage | Message[]>
): Record<string, MessagePage> {
  const normalized: Record<string, MessagePage> = {};

  const buildMessageIndexById = (messages: Message[]): Record<string, number> => {
    const index: Record<string, number> = {};
    messages.forEach((message, position) => {
      index[message.id] = position;
    });
    return index;
  };

  Object.entries(input).forEach(([conversationId, value]) => {
    if (Array.isArray(value)) {
      normalized[conversationId] = {
        messages: value as Message[],
        hasMore: false,
        cursor: null,
        messageIndexById: buildMessageIndexById(value as Message[])
      };
      return;
    }

    if (value && Array.isArray(value.messages)) {
      normalized[conversationId] = {
        messages: value.messages,
        hasMore: typeof value.hasMore === 'boolean' ? value.hasMore : false,
        cursor: typeof value.cursor === 'string' || value.cursor === null ? value.cursor : null,
        messageIndexById: buildMessageIndexById(value.messages)
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
      reduceMotion: snapshot.preferences?.reduceMotion ? nextReduceMotion : current.reduceMotion
    });
  },
  clearAccountScopedState: () =>
    a[0]({
      persistedOwnerUserId: null,
      selectedArtistId: null,
      conversations: {},
      activeConversationId: null,
      messagesByConversation: {},
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
      lastActiveDate: state.lastActiveDate
    },
    preferences: {
      language: state.language,
      displayMode: state.displayMode,
      reduceMotion: state.reduceMotion
    }
  };
}
