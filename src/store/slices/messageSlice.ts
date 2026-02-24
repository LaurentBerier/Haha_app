import type { StateCreator } from 'zustand';
import type { Message, MessagePage } from '../../models/Message';
import type { StoreState } from '../useStore';

export interface MessageSlice {
  messagesByConversation: Record<string, MessagePage>;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  appendMessageContent: (conversationId: string, messageId: string, token: string) => void;
  getMessages: (conversationId: string) => Message[];
}

const EMPTY_PAGE: MessagePage = {
  messages: [],
  hasMore: false,
  cursor: null
};

function getMessagePage(state: StoreState, conversationId: string): MessagePage {
  return state.messagesByConversation[conversationId] ?? EMPTY_PAGE;
}

export const createMessageSlice: StateCreator<StoreState, [], [], MessageSlice> = (set, get) => ({
  messagesByConversation: {},
  addMessage: (conversationId, message) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: {
          ...getMessagePage(state, conversationId),
          messages: [...getMessagePage(state, conversationId).messages, message]
        }
      }
    })),
  updateMessage: (conversationId, messageId, updates) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: {
          ...getMessagePage(state, conversationId),
          messages: getMessagePage(state, conversationId).messages.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  ...updates
                }
              : message
          )
        }
      }
    })),
  appendMessageContent: (conversationId, messageId, token) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: {
          ...getMessagePage(state, conversationId),
          messages: getMessagePage(state, conversationId).messages.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  content: message.content + token,
                  status: 'streaming' as const
                }
              : message
          )
        }
      }
    })),
  getMessages: (conversationId) => get().messagesByConversation[conversationId]?.messages ?? []
});
