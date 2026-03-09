import { useEffect, useMemo } from 'react';
import { hasPermission } from '../config/accountTypes';
import { getStoredSession, getUsageSummary, onAuthStateChange } from '../services/authService';
import { useStore } from '../store/useStore';

export function useAuth() {
  const session = useStore((state) => state.session);
  const authStatus = useStore((state) => state.authStatus);
  const userProfile = useStore((state) => state.userProfile);
  const setSession = useStore((state) => state.setSession);
  const setAuthStatus = useStore((state) => state.setAuthStatus);
  const clearSession = useStore((state) => state.clearSession);
  const clearUserProfile = useStore((state) => state.clearUserProfile);
  const clearAccountScopedState = useStore((state) => state.clearAccountScopedState);
  const hydrateQuota = useStore((state) => state.hydrateQuota);
  const resetQuota = useStore((state) => state.resetQuota);
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
        const hasLocalChatData = () => {
          const state = useStore.getState();
          return (
            Object.keys(state.conversations).length > 0 ||
            Object.keys(state.messagesByConversation).length > 0 ||
            state.activeConversationId !== null
          );
        };

        if (!storedSession) {
          if (hasLocalChatData()) {
            clearAccountScopedState();
          }
          resetQuota();
          return;
        }

        const currentOwnerUserId = useStore.getState().persistedOwnerUserId;
        if (currentOwnerUserId !== storedSession.user.id && hasLocalChatData()) {
          clearAccountScopedState();
        }

        const accountType = storedSession.user.accountType ?? 'free';
        try {
          const usageSummary = await getUsageSummary(storedSession.accessToken);
          if (!isMounted) {
            return;
          }
          hydrateQuota(usageSummary.messagesUsed, accountType);
        } catch {
          if (isMounted) {
            hydrateQuota(0, accountType);
          }
        }
      } catch {
        if (!isMounted) {
          return;
        }
        clearSession();
        resetQuota();
      }
    };

    bootstrap().catch((error) => {
      console.error('[useAuth] bootstrap failed', error);
      if (isMounted) {
        clearSession();
      }
    });

    const unsubscribe = onAuthStateChange((event, nextSession) => {
      if (!isMounted) {
        return;
      }

      if (event === 'SIGNED_OUT') {
        clearSession();
        clearUserProfile();
        clearAccountScopedState();
        resetQuota();
        return;
      }

      const syncSession = async () => {
        const currentSessionUserId = useStore.getState().session?.user.id ?? null;
        await setSession(nextSession);
        if (!nextSession) {
          clearAccountScopedState();
          resetQuota();
          return;
        }

        const hasLocalChatData =
          Object.keys(useStore.getState().conversations).length > 0 ||
          Object.keys(useStore.getState().messagesByConversation).length > 0 ||
          useStore.getState().activeConversationId !== null;
        const didUserChange = currentSessionUserId !== null && currentSessionUserId !== nextSession.user.id;

        const currentOwnerUserId = useStore.getState().persistedOwnerUserId;
        if ((currentOwnerUserId !== nextSession.user.id || didUserChange) && hasLocalChatData) {
          clearAccountScopedState();
        }

        const accountType = nextSession.user.accountType ?? 'free';
        try {
          const usageSummary = await getUsageSummary(nextSession.accessToken);
          if (!isMounted) {
            return;
          }
          hydrateQuota(usageSummary.messagesUsed, accountType);
        } catch {
          if (isMounted) {
            hydrateQuota(0, accountType);
          }
        }
      };

      syncSession().catch((error) => {
        console.error('[useAuth] auth state sync failed', error);
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [
    clearAccountScopedState,
    clearSession,
    clearUserProfile,
    hydrateQuota,
    resetQuota,
    setAuthStatus,
    setSession
  ]);

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
