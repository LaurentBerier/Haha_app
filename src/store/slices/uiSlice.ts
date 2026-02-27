import type { StateCreator } from 'zustand';
import type { StoreState } from '../useStore';

export type VoiceStatus = 'idle' | 'recording' | 'transcribing' | 'error';

export interface UiSlice {
  isLoading: boolean;
  voiceStatus: VoiceStatus;
  setLoading: (val: boolean) => void;
  setVoiceStatus: (status: VoiceStatus) => void;
}

export const createUiSlice: StateCreator<StoreState, [], [], UiSlice> = (set) => ({
  isLoading: false,
  voiceStatus: 'idle',
  setLoading: (val) => set({ isLoading: val }),
  setVoiceStatus: (status) => set({ voiceStatus: status })
});
