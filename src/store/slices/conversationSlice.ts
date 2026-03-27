import type { StateCreator } from 'zustand';
import { t } from '../../i18n';
import {
  DEFAULT_CONVERSATION_THREAD_TYPE,
  normalizeConversationThreadType,
  type Conversation,
  type ConversationThreadType
} from '../../models/Conversation';
import { generateId } from '../../utils/generateId';
import type { StoreState } from '../useStore';

const MAX_CONVERSATIONS_PER_ARTIST = 50;

export interface ConversationSlice {
  conversations: Record<string, Conversation[]>;
  activeConversationId: string | null;
  createConversation: (
    artistId: string,
    language: string,
    modeId: string,
    options?: { threadType?: ConversationThreadType }
  ) => Conversation;
  setActiveConversation: (id: string) => void;
  updateConversation: (id: string, updates: Partial<Conversation>, artistId: string) => void;
}

export const createConversationSlice: StateCreator<StoreState, [], [], ConversationSlice> = (set, get) => ({
  conversations: {},
  activeConversationId: null,
  createConversation: (artistId, language, modeId, options) => {
    const now = new Date().toISOString();
    const threadType = normalizeConversationThreadType(options?.threadType ?? DEFAULT_CONVERSATION_THREAD_TYPE);
    const conversation: Conversation = {
      id: generateId('conv'),
      artistId,
      title: t('newConversation'),
      language,
      modeId,
      threadType,
      createdAt: now,
      updatedAt: now,
      lastMessagePreview: ''
    };

    set((state) => {
      const existing = state.conversations[artistId] ?? [];
      const updated = [...existing, conversation];
      const capped =
        updated.length > MAX_CONVERSATIONS_PER_ARTIST
          ? updated.slice(updated.length - MAX_CONVERSATIONS_PER_ARTIST)
          : updated;

      return {
        conversations: {
          ...state.conversations,
          [artistId]: capped
        },
        activeConversationId: conversation.id
      };
    });

    return conversation;
  },
  setActiveConversation: (id) => set({ activeConversationId: id }),
  updateConversation: (id, updates, artistId) => {
    const current = get().conversations;
    const list = current[artistId] ?? [];
    set({
      conversations: {
        ...current,
        [artistId]: list.map((conversation) =>
          conversation.id === id
            ? {
                ...conversation,
                ...updates,
                updatedAt: new Date().toISOString()
              }
            : conversation
        )
      }
    });
  }
});
