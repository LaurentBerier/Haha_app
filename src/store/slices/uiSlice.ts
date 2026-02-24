import type { StateCreator } from 'zustand';
import type { StoreState } from '../useStore';

export interface UiSlice {
  isLoading: boolean;
  isSidebarOpen: boolean;
  currentModal: string | null;
  keyboardVisible: boolean;
  setLoading: (val: boolean) => void;
}

export const createUiSlice: StateCreator<StoreState, [], [], UiSlice> = (set) => ({
  isLoading: false,
  isSidebarOpen: false,
  currentModal: null,
  keyboardVisible: false,
  setLoading: (val) => set({ isLoading: val })
});
