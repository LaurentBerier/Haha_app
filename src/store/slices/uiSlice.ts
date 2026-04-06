import type { StateCreator } from 'zustand';
import { APP_DEFAULT_LANGUAGE } from '../../config/constants';
import { setLanguage as setI18nLanguage } from '../../i18n';
import type { ChatSendPayload } from '../../models/ChatSendPayload';
import type { StoreState } from '../useStore';

export type VoiceStatus = 'idle' | 'recording' | 'transcribing' | 'error';
export type AppLanguage = 'fr-CA' | 'en-CA';
export type DisplayMode = 'dark';
export type ReduceMotionPreference = 'system' | 'on' | 'off';

export interface QueuedChatSendPayload {
  nonce: string;
  conversationId: string;
  payload: ChatSendPayload;
}

export type SessionExperienceType = 'mode' | 'game';

export interface SessionExperienceEvent {
  artistId: string;
  experienceType: SessionExperienceType;
  experienceId: string;
  occurredAt: string;
}

const MAX_SESSION_EXPERIENCE_EVENTS_PER_ARTIST = 40;

function resolveLanguage(language: string | null | undefined): AppLanguage {
  if (!language) {
    return 'fr-CA';
  }

  const normalized = language.toLowerCase();
  if (normalized.startsWith('en')) {
    return 'en-CA';
  }
  return 'fr-CA';
}

function normalizeSessionEventTimestamp(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const parsed = Date.parse(normalized);
  if (normalized && Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

export interface UiSlice {
  isLoading: boolean;
  voiceStatus: VoiceStatus;
  language: AppLanguage;
  displayMode: DisplayMode;
  reduceMotion: ReduceMotionPreference;
  voiceAutoPlay: boolean;
  conversationModeEnabled: boolean;
  completedTutorials: Record<string, boolean>;
  greetedArtistIds: Set<string>;
  queuedChatSendPayload: QueuedChatSendPayload | null;
  modeSelectSessionHubConversationByArtist: Record<string, string>;
  sessionExperienceEventsByArtist: Record<string, SessionExperienceEvent[]>;
  setLoading: (val: boolean) => void;
  setVoiceStatus: (status: VoiceStatus) => void;
  setLanguagePreference: (language: AppLanguage) => void;
  setDisplayMode: (mode: DisplayMode) => void;
  setReduceMotion: (mode: ReduceMotionPreference) => void;
  setVoiceAutoPlay: (enabled: boolean) => void;
  setConversationModeEnabled: (enabled: boolean) => void;
  markArtistGreeted: (artistId: string) => void;
  markTutorialCompleted: (tutorialId: string) => void;
  setModeSelectSessionHubConversation: (artistId: string, conversationId: string) => void;
  trackSessionExperienceEvent: (entry: Omit<SessionExperienceEvent, 'occurredAt'> & { occurredAt?: string }) => void;
  queueChatSendPayload: (entry: QueuedChatSendPayload) => void;
  consumeChatSendPayload: (conversationId: string, nonce: string) => ChatSendPayload | null;
}

export const createUiSlice: StateCreator<StoreState, [], [], UiSlice> = (set, get) => ({
  isLoading: false,
  voiceStatus: 'idle',
  language: resolveLanguage(APP_DEFAULT_LANGUAGE),
  displayMode: 'dark',
  reduceMotion: 'system',
  voiceAutoPlay: true,
  conversationModeEnabled: true,
  completedTutorials: {},
  greetedArtistIds: new Set<string>(),
  queuedChatSendPayload: null,
  modeSelectSessionHubConversationByArtist: {},
  sessionExperienceEventsByArtist: {},
  setLoading: (val) => set({ isLoading: val }),
  setVoiceStatus: (status) => set({ voiceStatus: status }),
  setLanguagePreference: (language) => {
    setI18nLanguage(language);
    set({ language: resolveLanguage(language) });
  },
  setDisplayMode: () => set({ displayMode: 'dark' }),
  setReduceMotion: (mode) => set({ reduceMotion: mode }),
  setVoiceAutoPlay: (enabled) => set({ voiceAutoPlay: enabled }),
  setConversationModeEnabled: (enabled) => set({ conversationModeEnabled: enabled }),
  markArtistGreeted: (artistId) =>
    set((state) => {
      const normalizedArtistId = artistId.trim();
      if (!normalizedArtistId || state.greetedArtistIds.has(normalizedArtistId)) {
        return {};
      }

      const next = new Set(state.greetedArtistIds);
      next.add(normalizedArtistId);
      return { greetedArtistIds: next };
    }),
  markTutorialCompleted: (tutorialId) =>
    set((state) => {
      const normalizedId = tutorialId.trim();
      if (!normalizedId || state.completedTutorials[normalizedId]) {
        return {};
      }
      return { completedTutorials: { ...state.completedTutorials, [normalizedId]: true } };
    }),
  setModeSelectSessionHubConversation: (artistId, conversationId) =>
    set((state) => {
      const normalizedArtistId = artistId.trim();
      if (!normalizedArtistId) {
        return {};
      }

      const normalizedConversationId = conversationId.trim();
      const currentMap = state.modeSelectSessionHubConversationByArtist;
      const previousConversationId = currentMap[normalizedArtistId] ?? '';

      if (!normalizedConversationId) {
        if (!previousConversationId) {
          return {};
        }

        const nextMap = { ...currentMap };
        delete nextMap[normalizedArtistId];
        return { modeSelectSessionHubConversationByArtist: nextMap };
      }

      if (previousConversationId === normalizedConversationId) {
        return {};
      }

      return {
        modeSelectSessionHubConversationByArtist: {
          ...currentMap,
          [normalizedArtistId]: normalizedConversationId
        }
      };
    }),
  trackSessionExperienceEvent: (entry) =>
    set((state) => {
      const normalizedArtistId = entry.artistId.trim();
      const normalizedExperienceId = entry.experienceId.trim();
      const experienceType =
        entry.experienceType === 'mode' || entry.experienceType === 'game' ? entry.experienceType : null;
      if (!normalizedArtistId || !normalizedExperienceId || !experienceType) {
        return {};
      }

      const occurredAt = normalizeSessionEventTimestamp(entry.occurredAt);
      const nextEvent: SessionExperienceEvent = {
        artistId: normalizedArtistId,
        experienceType,
        experienceId: normalizedExperienceId,
        occurredAt
      };
      const currentByArtist = state.sessionExperienceEventsByArtist;
      const previousEvents = currentByArtist[normalizedArtistId] ?? [];
      const nextEvents = [...previousEvents, nextEvent].slice(-MAX_SESSION_EXPERIENCE_EVENTS_PER_ARTIST);

      return {
        sessionExperienceEventsByArtist: {
          ...currentByArtist,
          [normalizedArtistId]: nextEvents
        }
      };
    }),
  queueChatSendPayload: (entry) => set({ queuedChatSendPayload: entry }),
  consumeChatSendPayload: (conversationId, nonce) => {
    const current = get().queuedChatSendPayload;
    if (!current) {
      return null;
    }

    if (current.conversationId !== conversationId || current.nonce !== nonce) {
      return null;
    }

    set({ queuedChatSendPayload: null });
    return current.payload;
  }
});
