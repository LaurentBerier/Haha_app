import type { StateCreator } from 'zustand';
import type { AuthSession, AuthUser } from '../../models/AuthUser';
import type { AccountTypeId } from '../../config/accountTypes';
import { fetchAccountType, fetchProfile } from '../../services/profileService';
import { isAdminRole, resolveEffectiveAccountType } from '../../utils/accountTypeUtils';
import { isSameSessionUser } from '../../utils/authSession';
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

function toKnownAccountType(value: string | null, fallback: AccountTypeId | null, role: string | null): AccountTypeId | null {
  if (!value && !fallback) {
    return isAdminRole(role) ? 'admin' : fallback;
  }

  return resolveEffectiveAccountType(value ?? fallback, role);
}

function shouldKeepAuthenticatedDuringSessionRefresh(
  currentSession: AuthSession,
  currentAuthStatus: AuthStatus,
  nextSession: AuthSession
): boolean {
  return currentAuthStatus === 'authenticated' && isSameSessionUser(currentSession, nextSession);
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

    const currentSession = get().session;
    const currentAuthStatus = get().authStatus;
    const keepAuthenticated = shouldKeepAuthenticatedDuringSessionRefresh(currentSession, currentAuthStatus, session);

    set({
      session,
      authStatus: keepAuthenticated ? 'authenticated' : 'loading'
    });

    try {
      const [profileResult, accountTypeResult] = await Promise.allSettled([
        fetchProfile(session.user.id),
        fetchAccountType(session.user.id)
      ]);
      const profile = profileResult.status === 'fulfilled' ? profileResult.value : null;
      const accountTypeFromProfile = accountTypeResult.status === 'fulfilled' ? accountTypeResult.value : null;
      const resolvedAccountType = toKnownAccountType(accountTypeFromProfile, session.user.accountType, session.user.role);
      const mergedSession: AuthSession = {
        ...session,
        user: {
          ...session.user,
          accountType: resolvedAccountType
        }
      };
      const preferredName =
        typeof session.user.displayName === 'string' && session.user.displayName.trim().length > 0
          ? session.user.displayName.trim()
          : null;
      set({
        session: mergedSession,
        authStatus: 'authenticated',
        userProfile: profile ? { ...profile, preferredName } : profile
      });
    } catch (error) {
      console.error('[authSlice] Failed to fetch profile for authenticated session', error);
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
