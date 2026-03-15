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

export interface UiSlice {
  isLoading: boolean;
  voiceStatus: VoiceStatus;
  language: AppLanguage;
  displayMode: DisplayMode;
  reduceMotion: ReduceMotionPreference;
  voiceAutoPlay: boolean;
  conversationModeEnabled: boolean;
  greetedArtistIds: Set<string>;
  queuedChatSendPayload: QueuedChatSendPayload | null;
  setLoading: (val: boolean) => void;
  setVoiceStatus: (status: VoiceStatus) => void;
  setLanguagePreference: (language: AppLanguage) => void;
  setDisplayMode: (mode: DisplayMode) => void;
  setReduceMotion: (mode: ReduceMotionPreference) => void;
  setVoiceAutoPlay: (enabled: boolean) => void;
  setConversationModeEnabled: (enabled: boolean) => void;
  markArtistGreeted: (artistId: string) => void;
  queueChatSendPayload: (entry: QueuedChatSendPayload) => void;
  consumeChatSendPayload: (conversationId: string, nonce: string) => ChatSendPayload | null;
}

export const createUiSlice: StateCreator<StoreState, [], [], UiSlice> = (set, get) => ({
  isLoading: false,
  voiceStatus: 'idle',
  language: resolveLanguage(APP_DEFAULT_LANGUAGE),
  displayMode: 'dark',
  reduceMotion: 'system',
  voiceAutoPlay: false,
  conversationModeEnabled: true,
  greetedArtistIds: new Set<string>(),
  queuedChatSendPayload: null,
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
