import type { StateCreator } from 'zustand';
import { APP_DEFAULT_LANGUAGE } from '../../config/constants';
import { setLanguage as setI18nLanguage } from '../../i18n';
import type { StoreState } from '../useStore';

export type VoiceStatus = 'idle' | 'recording' | 'transcribing' | 'error';
export type AppLanguage = 'fr-CA' | 'en-CA';
export type DisplayMode = 'dark';
export type ReduceMotionPreference = 'system' | 'on' | 'off';

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
  setLoading: (val: boolean) => void;
  setVoiceStatus: (status: VoiceStatus) => void;
  setLanguagePreference: (language: AppLanguage) => void;
  setDisplayMode: (mode: DisplayMode) => void;
  setReduceMotion: (mode: ReduceMotionPreference) => void;
  setVoiceAutoPlay: (enabled: boolean) => void;
  setConversationModeEnabled: (enabled: boolean) => void;
  markArtistGreeted: (artistId: string) => void;
}

export const createUiSlice: StateCreator<StoreState, [], [], UiSlice> = (set) => ({
  isLoading: false,
  voiceStatus: 'idle',
  language: resolveLanguage(APP_DEFAULT_LANGUAGE),
  displayMode: 'dark',
  reduceMotion: 'system',
  voiceAutoPlay: false,
  conversationModeEnabled: true,
  greetedArtistIds: new Set<string>(),
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
    })
});
