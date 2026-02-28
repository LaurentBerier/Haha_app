import { useEffect, useMemo } from 'react';
import { hasPermission } from '../config/accountTypes';
import { getStoredSession, onAuthStateChange } from '../services/authService';
import { clearLegacySecureStoreData } from '../services/persistenceService';
import { useStore } from '../store/useStore';

export function useAuth() {
  const session = useStore((state) => state.session);
  const authStatus = useStore((state) => state.authStatus);
  const userProfile = useStore((state) => state.userProfile);
  const setSession = useStore((state) => state.setSession);
  const setAuthStatus = useStore((state) => state.setAuthStatus);
  const clearSession = useStore((state) => state.clearSession);
  const clearUserProfile = useStore((state) => state.clearUserProfile);
  const getCurrentUser = useStore((state) => state.getCurrentUser);

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      setAuthStatus('loading');
      try {
        const storedSession = await getStoredSession();
        if (!isMounted) {
          return;
        }

        await setSession(storedSession);

        if (storedSession?.user?.id) {
          await clearLegacySecureStoreData();
        }
      } catch {
        if (!isMounted) {
          return;
        }
        clearSession();
      }
    };

    void bootstrap();

    const unsubscribe = onAuthStateChange((event, nextSession) => {
      if (!isMounted) {
        return;
      }

      if (event === 'SIGNED_OUT') {
        clearSession();
        clearUserProfile();
        return;
      }

      void setSession(nextSession).then(() => {
        if (nextSession?.user?.id) {
          void clearLegacySecureStoreData();
        }
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [clearSession, clearUserProfile, setAuthStatus, setSession]);

  const user = getCurrentUser();
  const accountType = user?.accountType ?? null;
  const role = user?.role ?? null;
  const isAdmin = hasPermission(accountType, 'admin:all') || role === 'admin';
  const isAuthenticated = authStatus === 'authenticated' && Boolean(session);
  const isLoading = authStatus === 'loading';

  return useMemo(
    () => ({
      session,
      authStatus,
      isAuthenticated,
      isLoading,
      user,
      accountType,
      role,
      isAdmin,
      userProfile,
      setSession,
      clearSession
    }),
    [
      accountType,
      authStatus,
      clearSession,
      isAdmin,
      isAuthenticated,
      isLoading,
      role,
      session,
      setSession,
      user,
      userProfile
    ]
  );
}
