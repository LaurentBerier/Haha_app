import type { StateCreator } from 'zustand';
import { APP_DEFAULT_LANGUAGE } from '../../config/constants';
import { setLanguage as setI18nLanguage } from '../../i18n';
import type { StoreState } from '../useStore';

export type VoiceStatus = 'idle' | 'recording' | 'transcribing' | 'error';
export type AppLanguage = 'fr-CA' | 'en-CA';
export type DisplayMode = 'dark' | 'light' | 'system';

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
  setLoading: (val: boolean) => void;
  setVoiceStatus: (status: VoiceStatus) => void;
  setLanguagePreference: (language: AppLanguage) => void;
  setDisplayMode: (mode: DisplayMode) => void;
}

export const createUiSlice: StateCreator<StoreState, [], [], UiSlice> = (set) => ({
  isLoading: false,
  voiceStatus: 'idle',
  language: resolveLanguage(APP_DEFAULT_LANGUAGE),
  displayMode: 'dark',
  setLoading: (val) => set({ isLoading: val }),
  setVoiceStatus: (status) => set({ voiceStatus: status }),
  setLanguagePreference: (language) => {
    setI18nLanguage(language);
    set({ language: resolveLanguage(language) });
  },
  setDisplayMode: (mode) => set({ displayMode: mode })
});
