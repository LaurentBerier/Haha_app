import { useEffect, useMemo, useRef } from 'react';
import { hasPermission } from '../config/accountTypes';
import { getStoredSession, getUsageSummary, onAuthStateChange } from '../services/authService';
import { getUserStats } from '../services/scoreManager';
import { useStore } from '../store/useStore';
import { resolveEffectiveAccountType } from '../utils/accountTypeUtils';
import { areAuthSessionsEquivalent } from '../utils/authSession';
import { EMPTY_GAMIFICATION_STATS } from '../models/Gamification';

interface UseAuthOptions {
  bootstrap?: boolean;
}

async function clearVoiceCacheOnSessionResetSafely(): Promise<void> {
  try {
    const ttsService = await import('../services/ttsService');
    ttsService.clearVoiceCacheOnSessionReset();
  } catch {
    // Best effort: session reset should continue even if voice cache cleanup fails.
  }
}

async function clearTerminalTtsCooldownsSafely(): Promise<void> {
  try {
    const ttsService = await import('../services/ttsService');
    ttsService.clearTerminalTtsCooldowns();
  } catch {
    // Best effort.
  }
}

function syncSessionAccountTypeFromUsageSummary(
  userId: string,
  role: string | null,
  usageAccountType: string | undefined
): void {
  if (typeof usageAccountType !== 'string' || !usageAccountType.trim()) {
    return;
  }

  const latestSession = useStore.getState().session;
  if (!latestSession || latestSession.user.id !== userId) {
    return;
  }

  const resolvedAccountType = resolveEffectiveAccountType(usageAccountType, role);
  if (latestSession.user.accountType === resolvedAccountType) {
    return;
  }

  useStore.setState({
    session: {
      ...latestSession,
      user: {
        ...latestSession.user,
        accountType: resolvedAccountType
      }
    }
  });
}

export function useAuth(options: UseAuthOptions = {}) {
  const { bootstrap = false } = options;
  const session = useStore((state) => state.session);
  const authStatus = useStore((state) => state.authStatus);
  const userProfile = useStore((state) => state.userProfile);
  const setSession = useStore((state) => state.setSession);
  const setAuthStatus = useStore((state) => state.setAuthStatus);
  const clearSession = useStore((state) => state.clearSession);
  const clearUserProfile = useStore((state) => state.clearUserProfile);
  const clearAccountScopedState = useStore((state) => state.clearAccountScopedState);
  const hydrateQuota = useStore((state) => state.hydrateQuota);
  const hydrateQuotaWithCap = useStore((state) => state.hydrateQuotaWithCap);
  const resetQuota = useStore((state) => state.resetQuota);
  const hydrateGamification = useStore((state) => state.hydrateGamification);
  const resetGamification = useStore((state) => state.resetGamification);
  const getCurrentUser = useStore((state) => state.getCurrentUser);
  const sessionSyncRunIdRef = useRef(0);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    let isMounted = true;
    const nextRunId = () => {
      sessionSyncRunIdRef.current += 1;
      return sessionSyncRunIdRef.current;
    };
    const isRunCurrent = (runId: number) => isMounted && runId === sessionSyncRunIdRef.current;

    const runBootstrap = async () => {
      const runId = nextRunId();
      setAuthStatus('loading');
      try {
        const storedSession = await getStoredSession();
        if (!isRunCurrent(runId)) {
          return;
        }

        await setSession(storedSession);
        if (!isRunCurrent(runId)) {
          return;
        }
        const hasLocalChatData = () => {
          const state = useStore.getState();
          return (
            Object.keys(state.conversations).length > 0 ||
            Object.keys(state.messagesByConversation).length > 0 ||
            state.activeConversationId !== null
          );
        };

        if (!storedSession) {
          void clearVoiceCacheOnSessionResetSafely();
          if (hasLocalChatData()) {
            clearAccountScopedState();
          }
          resetQuota();
          resetGamification();
          return;
        }

        const bootstrapAccessToken = storedSession.accessToken.trim();
        if (!bootstrapAccessToken) {
          void clearVoiceCacheOnSessionResetSafely();
          clearSession();
          clearUserProfile();
          if (hasLocalChatData()) {
            clearAccountScopedState();
          }
          resetQuota();
          resetGamification();
          return;
        }

        const currentOwnerUserId = useStore.getState().persistedOwnerUserId;
        if (currentOwnerUserId !== storedSession.user.id && hasLocalChatData()) {
          clearAccountScopedState();
        }

        const accountType = resolveEffectiveAccountType(storedSession.user.accountType, storedSession.user.role);
        try {
          const usageSummary = await getUsageSummary(bootstrapAccessToken);
          if (!isRunCurrent(runId)) {
            return;
          }
          hydrateQuotaWithCap(usageSummary.messagesUsed, usageSummary.messagesCap);
          syncSessionAccountTypeFromUsageSummary(
            storedSession.user.id,
            storedSession.user.role,
            usageSummary.accountType
          );
        } catch {
          if (isRunCurrent(runId)) {
            hydrateQuota(0, accountType);
          }
        }

        try {
          await getUserStats(bootstrapAccessToken);
          if (!isRunCurrent(runId)) {
            return;
          }
        } catch {
          if (isRunCurrent(runId)) {
            hydrateGamification(EMPTY_GAMIFICATION_STATS);
          }
        }
      } catch {
        if (!isRunCurrent(runId)) {
          return;
        }
        void clearVoiceCacheOnSessionResetSafely();
        clearSession();
        resetQuota();
        resetGamification();
      }
    };

    runBootstrap().catch((error) => {
      console.error('[useAuth] bootstrap failed', error);
      if (isMounted) {
        void clearVoiceCacheOnSessionResetSafely();
        clearSession();
      }
    });

    const unsubscribe = onAuthStateChange((event, nextSession) => {
      if (!isMounted) {
        return;
      }

      if (event === 'SIGNED_OUT') {
        nextRunId();
        void clearVoiceCacheOnSessionResetSafely();
        clearSession();
        clearUserProfile();
        clearAccountScopedState();
        resetQuota();
        resetGamification();
        return;
      }

      const currentSession = useStore.getState().session;
      if (areAuthSessionsEquivalent(currentSession, nextSession)) {
        return;
      }

      const syncSession = async () => {
        const runId = nextRunId();
        const currentSessionUserId = currentSession?.user.id ?? null;
        await setSession(nextSession);
        if (!isRunCurrent(runId)) {
          return;
        }
        if (!nextSession) {
          void clearVoiceCacheOnSessionResetSafely();
          clearAccountScopedState();
          resetQuota();
          resetGamification();
          return;
        }

        const nextAccessToken = nextSession.accessToken.trim();
        if (!nextAccessToken) {
          void clearVoiceCacheOnSessionResetSafely();
          clearSession();
          clearUserProfile();
          clearAccountScopedState();
          resetQuota();
          resetGamification();
          return;
        }

        void clearTerminalTtsCooldownsSafely();

        const hasLocalChatData =
          Object.keys(useStore.getState().conversations).length > 0 ||
          Object.keys(useStore.getState().messagesByConversation).length > 0 ||
          useStore.getState().activeConversationId !== null;
        const didUserChange = currentSessionUserId !== null && currentSessionUserId !== nextSession.user.id;

        const currentOwnerUserId = useStore.getState().persistedOwnerUserId;
        if ((currentOwnerUserId !== nextSession.user.id || didUserChange) && hasLocalChatData) {
          clearAccountScopedState();
        }
        if (didUserChange) {
          void clearVoiceCacheOnSessionResetSafely();
        }

        const accountType = resolveEffectiveAccountType(nextSession.user.accountType, nextSession.user.role);
        try {
          const usageSummary = await getUsageSummary(nextAccessToken);
          if (!isRunCurrent(runId)) {
            return;
          }
          hydrateQuotaWithCap(usageSummary.messagesUsed, usageSummary.messagesCap);
          syncSessionAccountTypeFromUsageSummary(nextSession.user.id, nextSession.user.role, usageSummary.accountType);
        } catch {
          if (isRunCurrent(runId)) {
            hydrateQuota(0, accountType);
          }
        }

        try {
          await getUserStats(nextAccessToken);
          if (!isRunCurrent(runId)) {
            return;
          }
        } catch {
          if (isRunCurrent(runId)) {
            hydrateGamification(EMPTY_GAMIFICATION_STATS);
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
    bootstrap,
    clearAccountScopedState,
    clearSession,
    clearUserProfile,
    hydrateQuota,
    hydrateQuotaWithCap,
    hydrateGamification,
    resetQuota,
    resetGamification,
    setAuthStatus,
    setSession
  ]);

  const user = getCurrentUser();
  const role = user?.role ?? null;
  const accountType = user ? resolveEffectiveAccountType(user.accountType, role) : null;
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
