import type { StateCreator } from 'zustand';
import { MODE_IDS } from '../../config/constants';
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
  createAndPromotePrimaryConversation: (artistId: string, language: string) => Conversation;
  upsertPrimaryConversationFromCloud: (
    artistId: string,
    cloudThread: {
      language: string;
      title: string;
      lastMessagePreview: string;
      updatedAt: string;
      createdAt?: string;
    }
  ) => Conversation | null;
  setActiveConversation: (id: string) => void;
  updateConversation: (id: string, updates: Partial<Conversation>, artistId: string) => void;
}

function capConversationsByArtist(conversations: Conversation[]): Conversation[] {
  if (conversations.length <= MAX_CONVERSATIONS_PER_ARTIST) {
    return conversations;
  }

  return conversations.slice(conversations.length - MAX_CONVERSATIONS_PER_ARTIST);
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
      const currentHubMap = state.modeSelectSessionHubConversationByArtist ?? {};
      const updatedBeforeInsert =
        threadType === 'primary'
          ? existing.map((entry) =>
              normalizeConversationThreadType(entry.threadType) === 'primary'
                ? {
                    ...entry,
                    threadType: 'secondary' as const
                  }
                : entry
            )
          : existing;
      const updated = [...updatedBeforeInsert, conversation];
      const capped = capConversationsByArtist(updated);

      return {
        conversations: {
          ...state.conversations,
          [artistId]: capped
        },
        activeConversationId: conversation.id,
        modeSelectSessionHubConversationByArtist:
          threadType === 'primary'
            ? {
                ...currentHubMap,
                [artistId]: conversation.id
              }
            : currentHubMap
      };
    });

    return conversation;
  },
  createAndPromotePrimaryConversation: (artistId, language) =>
    get().createConversation(artistId, language, MODE_IDS.ON_JASE, { threadType: 'primary' }),
  upsertPrimaryConversationFromCloud: (artistId, cloudThread) => {
    const normalizedArtistId = artistId.trim();
    if (!normalizedArtistId) {
      return null;
    }

    const normalizedLanguage = cloudThread.language?.trim() || 'fr-CA';
    const normalizedTitle = cloudThread.title?.trim() || t('newConversation');
    const normalizedPreview = cloudThread.lastMessagePreview?.trim() ?? '';
    const parsedUpdatedAt = Date.parse(cloudThread.updatedAt);
    const normalizedUpdatedAt = Number.isFinite(parsedUpdatedAt)
      ? new Date(parsedUpdatedAt).toISOString()
      : new Date().toISOString();
    const parsedCreatedAt = Date.parse(cloudThread.createdAt ?? '');
    const normalizedCreatedAt = Number.isFinite(parsedCreatedAt) ? new Date(parsedCreatedAt).toISOString() : normalizedUpdatedAt;

    let resolvedConversation: Conversation | null = null;

    set((state) => {
      const existing = state.conversations[normalizedArtistId] ?? [];
      const currentHubMap = state.modeSelectSessionHubConversationByArtist ?? {};

      const existingPrimary =
        existing.find((conversation) => normalizeConversationThreadType(conversation.threadType) === 'primary') ?? null;

      if (existingPrimary) {
        const localUpdatedAtMs = Date.parse(existingPrimary.updatedAt);
        const cloudUpdatedAtMs = Date.parse(normalizedUpdatedAt);
        const shouldApplyCloudMetadata =
          (Number.isFinite(cloudUpdatedAtMs) ? cloudUpdatedAtMs : 0) >=
          (Number.isFinite(localUpdatedAtMs) ? localUpdatedAtMs : 0);

        const updatedPrimary: Conversation = {
          ...existingPrimary,
          modeId: MODE_IDS.ON_JASE,
          threadType: 'primary',
          language: shouldApplyCloudMetadata ? normalizedLanguage : existingPrimary.language,
          title: shouldApplyCloudMetadata ? normalizedTitle : existingPrimary.title,
          lastMessagePreview: shouldApplyCloudMetadata ? normalizedPreview : existingPrimary.lastMessagePreview,
          updatedAt: shouldApplyCloudMetadata ? normalizedUpdatedAt : existingPrimary.updatedAt
        };
        resolvedConversation = updatedPrimary;

        const updatedConversations = existing.map((conversation) => {
          if (conversation.id === existingPrimary.id) {
            return updatedPrimary;
          }
          if (normalizeConversationThreadType(conversation.threadType) === 'primary') {
            return {
              ...conversation,
              threadType: 'secondary' as const
            };
          }
          return conversation;
        });

        return {
          conversations: {
            ...state.conversations,
            [normalizedArtistId]: capConversationsByArtist(updatedConversations)
          },
          modeSelectSessionHubConversationByArtist: {
            ...currentHubMap,
            [normalizedArtistId]: updatedPrimary.id
          }
        };
      }

      const createdPrimary: Conversation = {
        id: generateId('conv'),
        artistId: normalizedArtistId,
        title: normalizedTitle,
        language: normalizedLanguage,
        modeId: MODE_IDS.ON_JASE,
        threadType: 'primary',
        createdAt: normalizedCreatedAt,
        updatedAt: normalizedUpdatedAt,
        lastMessagePreview: normalizedPreview
      };
      resolvedConversation = createdPrimary;

      const demotedConversations = existing.map((conversation) =>
        normalizeConversationThreadType(conversation.threadType) === 'primary'
          ? {
              ...conversation,
              threadType: 'secondary' as const
            }
          : conversation
      );
      const updatedConversations = capConversationsByArtist([...demotedConversations, createdPrimary]);

      return {
        conversations: {
          ...state.conversations,
          [normalizedArtistId]: updatedConversations
        },
        modeSelectSessionHubConversationByArtist: {
          ...currentHubMap,
          [normalizedArtistId]: createdPrimary.id
        }
      };
    });

    return resolvedConversation;
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
