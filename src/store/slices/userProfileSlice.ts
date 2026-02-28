import type { StateCreator } from 'zustand';
import type { UserProfile } from '../../models/UserProfile';
import type { StoreState } from '../useStore';

export interface UserProfileSlice {
  userProfile: UserProfile | null;
  setUserProfile: (profile: UserProfile | null) => void;
  updateUserProfile: (partial: Partial<UserProfile>) => void;
  clearUserProfile: () => void;
}

export const createUserProfileSlice: StateCreator<StoreState, [], [], UserProfileSlice> = (set) => ({
  userProfile: null,
  setUserProfile: (profile) => set({ userProfile: profile }),
  updateUserProfile: (partial) =>
    set((state) => ({
      userProfile: state.userProfile
        ? {
            ...state.userProfile,
            ...partial
          }
        : null
    })),
  clearUserProfile: () => set({ userProfile: null })
});
