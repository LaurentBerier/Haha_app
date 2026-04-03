import type { StateCreator } from 'zustand';
import type { Message, MessagePage } from '../../models/Message';
import type { StoreState } from '../useStore';

export interface MessageSlice {
  messagesByConversation: Record<string, MessagePage>;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  appendMessageContent: (conversationId: string, messageId: string, token: string) => void;
  mergePrimaryMessagesFromCloud: (
    conversationId: string,
    cloudMessages: Array<Pick<Message, 'id' | 'role' | 'content' | 'timestamp' | 'status' | 'metadata'>>
  ) => void;
  getMessages: (conversationId: string) => Message[];
}

const EMPTY_PAGE: MessagePage = {
  messages: [],
  hasMore: false,
  cursor: null,
  messageIndexById: {}
};

function getMessagePage(state: StoreState, conversationId: string): MessagePage {
  return state.messagesByConversation[conversationId] ?? EMPTY_PAGE;
}

function buildMessageIndexById(messages: Message[]): Record<string, number> {
  const index: Record<string, number> = {};
  messages.forEach((message, position) => {
    index[message.id] = position;
  });
  return index;
}

function getMessageIndexById(page: MessagePage): Record<string, number> {
  return page.messageIndexById ?? buildMessageIndexById(page.messages);
}

function updateMessageByIndex(
  messages: Message[],
  index: number,
  update: (current: Message) => Message
): Message[] {
  if (index < 0 || index >= messages.length) {
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

function normalizeMessageTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return new Date().toISOString();
  }
  return new Date(parsed).toISOString();
}

export const createMessageSlice: StateCreator<StoreState, [], [], MessageSlice> = (set, get) => ({
  messagesByConversation: {},
  addMessage: (conversationId, message) =>
    set((state) => {
      const page = getMessagePage(state, conversationId);
      const nextMessages = [...page.messages, message];
      const nextIndexById = {
        ...getMessageIndexById(page),
        [message.id]: nextMessages.length - 1
      };

      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: {
            ...page,
            messages: nextMessages,
            messageIndexById: nextIndexById
          }
        }
      };
    }),
  updateMessage: (conversationId, messageId, updates) =>
    set((state) => {
      const page = getMessagePage(state, conversationId);
      const indexById = getMessageIndexById(page);
      const index = typeof indexById[messageId] === 'number' ? indexById[messageId] : -1;
      const nextMessages = updateMessageByIndex(page.messages, index, (message) => ({ ...message, ...updates }));
      if (nextMessages === page.messages) {
        return state;
      }

      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: {
            ...page,
            messages: nextMessages,
            messageIndexById: indexById
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
      const indexById = getMessageIndexById(page);
      const index = typeof indexById[messageId] === 'number' ? indexById[messageId] : -1;
      const nextMessages = updateMessageByIndex(page.messages, index, (message) => ({
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
            messages: nextMessages,
            messageIndexById: indexById
          }
        }
      };
    }),
  mergePrimaryMessagesFromCloud: (conversationId, cloudMessages) =>
    set((state) => {
      const normalizedConversationId = conversationId.trim();
      if (!normalizedConversationId || cloudMessages.length === 0) {
        return state;
      }

      const page = getMessagePage(state, normalizedConversationId);
      const nextById = new Map<string, Message>();

      for (const message of page.messages) {
        const normalizedId = message.id.trim();
        if (!normalizedId) {
          continue;
        }
        nextById.set(normalizedId, message);
      }

      let hasChanges = false;

      for (const cloudMessage of cloudMessages) {
        const normalizedId = cloudMessage.id.trim();
        const normalizedRole = cloudMessage.role === 'user' || cloudMessage.role === 'artist' ? cloudMessage.role : null;
        if (!normalizedId || !normalizedRole || cloudMessage.status !== 'complete') {
          continue;
        }

        const normalizedCloudMessage: Message = {
          id: normalizedId,
          conversationId: normalizedConversationId,
          role: normalizedRole,
          content: cloudMessage.content,
          status: 'complete',
          timestamp: normalizeMessageTimestamp(cloudMessage.timestamp),
          metadata: cloudMessage.metadata
        };
        const existing = nextById.get(normalizedId);
        if (!existing) {
          nextById.set(normalizedId, normalizedCloudMessage);
          hasChanges = true;
          continue;
        }

        if (existing.status !== 'complete') {
          nextById.set(normalizedId, {
            ...existing,
            ...normalizedCloudMessage
          });
          hasChanges = true;
        }
      }

      if (!hasChanges) {
        return state;
      }

      const nextMessages = Array.from(nextById.values()).sort((left, right) => {
        const leftTime = Date.parse(left.timestamp);
        const rightTime = Date.parse(right.timestamp);
        const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
        const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
        if (safeLeft !== safeRight) {
          return safeLeft - safeRight;
        }
        return left.id.localeCompare(right.id);
      });

      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [normalizedConversationId]: {
            ...page,
            messages: nextMessages,
            messageIndexById: buildMessageIndexById(nextMessages)
          }
        }
      };
    }),
  getMessages: (conversationId) => get().messagesByConversation[conversationId]?.messages ?? []
});
