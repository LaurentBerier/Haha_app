import type { StateCreator } from 'zustand';
import type { UserProfile } from '../../models/UserProfile';
import type { StoreState } from '../useStore';

export interface UserProfileSlice {
  userProfile: UserProfile | null;
  profileChangeHints: string[];
  setUserProfile: (profile: UserProfile | null) => void;
  updateUserProfile: (partial: Partial<UserProfile>) => void;
  enqueueProfileChangeHint: (hint: string) => void;
  popProfileChangeHints: () => string[];
  clearUserProfile: () => void;
}

function areStringArraysEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  const safeLeft = Array.isArray(left) ? left : [];
  const safeRight = Array.isArray(right) ? right : [];
  if (safeLeft.length !== safeRight.length) {
    return false;
  }
  return safeLeft.every((value, index) => value === safeRight[index]);
}

export const createUserProfileSlice: StateCreator<StoreState, [], [], UserProfileSlice> = (set, get) => ({
  userProfile: null,
  profileChangeHints: [],
  setUserProfile: (profile) => set({ userProfile: profile }),
  updateUserProfile: (partial) =>
    set((state) => {
      if (!state.userProfile) {
        return {
          userProfile: null
        };
      }

      const previous = state.userProfile;
      const next: UserProfile = {
        ...previous,
        ...partial
      };
      const hints: string[] = [];

      if (partial.relationshipStatus && partial.relationshipStatus !== previous.relationshipStatus) {
        hints.push(`[contexte: l'utilisateur vient de mettre a jour son statut: ${partial.relationshipStatus}]`);
      }
      if (partial.preferredName && partial.preferredName !== previous.preferredName) {
        hints.push(`[contexte: l'utilisateur prefere maintenant etre appele "${partial.preferredName}"]`);
      }
      if (typeof partial.age === 'number' && partial.age !== previous.age) {
        hints.push(`[contexte: l'utilisateur a mis a jour son age: ${partial.age}]`);
      }
      if (partial.sex && partial.sex !== previous.sex) {
        hints.push(`[contexte: l'utilisateur a mis a jour son genre: ${partial.sex}]`);
      }
      if (partial.horoscopeSign && partial.horoscopeSign !== previous.horoscopeSign) {
        hints.push(`[contexte: l'utilisateur a change son signe astro: ${partial.horoscopeSign}]`);
      }
      if (Array.isArray(partial.interests) && !areStringArraysEqual(partial.interests, previous.interests)) {
        hints.push(`[contexte: les centres d'interet de l'utilisateur ont change: ${partial.interests.join(', ')}]`);
      }

      if (hints.length === 0) {
        return {
          userProfile: next
        };
      }

      const nextHints = [...state.profileChangeHints, ...hints].slice(-12);
      return {
        userProfile: next,
        profileChangeHints: nextHints
      };
    }),
  enqueueProfileChangeHint: (hint) => {
    const normalized = typeof hint === 'string' ? hint.trim() : '';
    if (!normalized) {
      return;
    }

    set((state) => ({
      profileChangeHints: [...state.profileChangeHints, normalized].slice(-12)
    }));
  },
  popProfileChangeHints: () => {
    const hints = get().profileChangeHints;
    if (hints.length === 0) {
      return [];
    }

    set({ profileChangeHints: [] });
    return hints;
  },
  clearUserProfile: () => set({ userProfile: null, profileChangeHints: [] })
});
