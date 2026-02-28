import { create } from 'zustand';
import { MODE_IDS } from '../config/constants';
import type { Conversation } from '../models/Conversation';
import type { PersistedStoreSnapshot } from '../models/Persistence';
import type { Message, MessagePage } from '../models/Message';
import { createArtistAccessSlice, type ArtistAccessSlice } from './slices/artistAccessSlice';
import { createArtistSlice, type ArtistSlice } from './slices/artistSlice';
import { createAuthSlice, type AuthSlice } from './slices/authSlice';
import { createConversationSlice, type ConversationSlice } from './slices/conversationSlice';
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
  UiSlice & {
    hasHydrated: boolean;
    hydrateStore: (snapshot: PersistedStoreSnapshot) => void;
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

  Object.entries(input).forEach(([conversationId, value]) => {
    if (Array.isArray(value)) {
      normalized[conversationId] = {
        messages: value as Message[],
        hasMore: false,
        cursor: null
      };
      return;
    }

    if (value && Array.isArray(value.messages)) {
      normalized[conversationId] = {
        messages: value.messages,
        hasMore: typeof value.hasMore === 'boolean' ? value.hasMore : false,
        cursor: typeof value.cursor === 'string' || value.cursor === null ? value.cursor : null
      };
      return;
    }

    normalized[conversationId] = {
      messages: [],
      hasMore: false,
      cursor: null
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
  ...createUiSlice(...a),
  hasHydrated: false,
  hydrateStore: (snapshot) =>
    a[0]({
      selectedArtistId: snapshot.selectedArtistId,
      conversations: normalizeConversations(snapshot.conversations),
      activeConversationId: snapshot.activeConversationId,
      messagesByConversation: normalizeMessagesByConversation(snapshot.messagesByConversation)
    }),
  markHydrated: () => a[0]({ hasHydrated: true })
}));

export function selectPersistedSnapshot(state: StoreState): PersistedStoreSnapshot {
  return {
    selectedArtistId: state.selectedArtistId,
    conversations: state.conversations,
    activeConversationId: state.activeConversationId,
    messagesByConversation: state.messagesByConversation
  };
}
