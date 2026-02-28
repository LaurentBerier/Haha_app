import type { StateCreator } from 'zustand';
import type { AuthSession, AuthUser } from '../../models/AuthUser';
import { fetchProfile } from '../../services/profileService';
import type { StoreState } from '../useStore';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthSlice {
  session: AuthSession;
  authStatus: AuthStatus;
  setSession: (session: AuthSession) => Promise<void>;
  setAuthStatus: (status: AuthStatus) => void;
  clearSession: () => void;
  getCurrentUser: () => AuthUser | null;
}

export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => ({
  session: null,
  authStatus: 'loading',
  setSession: async (session) => {
    if (!session) {
      set({
        session: null,
        authStatus: 'unauthenticated',
        userProfile: null
      });
      return;
    }

    set({
      session,
      authStatus: 'loading'
    });

    try {
      const profile = await fetchProfile(session.user.id);
      set({
        session,
        authStatus: 'authenticated',
        userProfile: profile
      });
    } catch {
      set({
        session,
        authStatus: 'authenticated'
      });
    }
  },
  setAuthStatus: (status) =>
    set({
      authStatus: status
    }),
  clearSession: () =>
    set({
      session: null,
      authStatus: 'unauthenticated',
      userProfile: null
    }),
  getCurrentUser: () => get().session?.user ?? null
});
