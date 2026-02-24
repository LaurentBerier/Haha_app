import type { StateCreator } from 'zustand';
import type { Conversation } from '../../models/Conversation';
import { generateId } from '../../utils/generateId';
import type { StoreState } from '../useStore';

export interface ConversationSlice {
  conversations: Record<string, Conversation[]>;
  activeConversationId: string | null;
  createConversation: (artistId: string, language: string) => Conversation;
  setActiveConversation: (id: string) => void;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
}

export const createConversationSlice: StateCreator<StoreState, [], [], ConversationSlice> = (set, get) => ({
  conversations: {},
  activeConversationId: null,
  createConversation: (artistId, language) => {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: generateId('conv'),
      artistId,
      title: 'Nouvelle conversation',
      language,
      createdAt: now,
      updatedAt: now,
      lastMessagePreview: ''
    };

    set((state) => ({
      conversations: {
        ...state.conversations,
        [artistId]: [...(state.conversations[artistId] ?? []), conversation]
      },
      activeConversationId: conversation.id
    }));

    return conversation;
  },
  setActiveConversation: (id) => set({ activeConversationId: id }),
  updateConversation: (id, updates) => {
    const current = get().conversations;
    const next: Record<string, Conversation[]> = {};

    Object.entries(current).forEach(([artistId, list]) => {
      next[artistId] = list.map((conversation) =>
        conversation.id === id
          ? {
              ...conversation,
              ...updates,
              updatedAt: new Date().toISOString()
            }
          : conversation
      );
    });

    set({ conversations: next });
  }
});
