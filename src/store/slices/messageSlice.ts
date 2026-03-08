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

function updateMessageByIndex(
  messages: Message[],
  messageId: string,
  update: (current: Message) => Message
): Message[] {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) {
    return messages;
  }

  const current = messages[index];
  if (!current) {
    return messages;
  }
  const next = update(current);
  if (next === current) {
    return messages;
  }

  const clone = messages.slice();
  clone[index] = next;
  return clone;
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
    set((state) => {
      const page = getMessagePage(state, conversationId);
      const nextMessages = updateMessageByIndex(page.messages, messageId, (message) => ({ ...message, ...updates }));
      if (nextMessages === page.messages) {
        return state;
      }

      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: {
            ...page,
            messages: nextMessages
          }
        }
      };
    }),
  appendMessageContent: (conversationId, messageId, token) =>
    set((state) => {
      if (!token) {
        return state;
      }

      const page = getMessagePage(state, conversationId);
      const nextMessages = updateMessageByIndex(page.messages, messageId, (message) => ({
        ...message,
        content: message.content + token,
        status: 'streaming' as const
      }));

      if (nextMessages === page.messages) {
        return state;
      }

      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: {
            ...page,
            messages: nextMessages
          }
        }
      };
    }),
  getMessages: (conversationId) => get().messagesByConversation[conversationId]?.messages ?? []
});
