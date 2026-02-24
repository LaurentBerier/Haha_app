import { create } from 'zustand';
import { createArtistSlice, type ArtistSlice } from './slices/artistSlice';
import { createConversationSlice, type ConversationSlice } from './slices/conversationSlice';
import { createMessageSlice, type MessageSlice } from './slices/messageSlice';
import { createSubscriptionSlice, type SubscriptionSlice } from './slices/subscriptionSlice';
import { createArtistAccessSlice, type ArtistAccessSlice } from './slices/artistAccessSlice';
import { createUsageSlice, type UsageSlice } from './slices/usageSlice';
import { createUiSlice, type UiSlice } from './slices/uiSlice';
import type { PersistedStoreSnapshot } from '../models/Persistence';
import type { Message, MessagePage } from '../models/Message';

export type StoreState = ArtistSlice &
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
      conversations: snapshot.conversations,
      activeConversationId: snapshot.activeConversationId,
      messagesByConversation: normalizeMessagesByConversation(snapshot.messagesByConversation),
      subscription: snapshot.subscription,
      unlockedArtistIds: snapshot.unlockedArtistIds,
      quota: snapshot.quota
    }),
  markHydrated: () => a[0]({ hasHydrated: true })
}));

export function selectPersistedSnapshot(state: StoreState): PersistedStoreSnapshot {
  return {
    selectedArtistId: state.selectedArtistId,
    conversations: state.conversations,
    activeConversationId: state.activeConversationId,
    messagesByConversation: state.messagesByConversation,
    subscription: state.subscription,
    unlockedArtistIds: state.unlockedArtistIds,
    quota: state.quota
  };
}
