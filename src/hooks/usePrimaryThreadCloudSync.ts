import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { MODE_IDS } from '../config/constants';
import { normalizeConversationThreadType } from '../models/Conversation';
import {
  fetchPrimaryThreadIndex,
  fetchPrimaryThreadMessages,
  type CloudPrimaryThread
} from '../services/primaryThreadSyncService';
import { useStore } from '../store/useStore';
import { findConversationById } from '../utils/conversationUtils';

const PRIMARY_THREAD_CLOUD_MESSAGE_LIMIT = 500;
const BOOTSTRAP_REFRESH_MS = 30_000;
const PULL_ARTIST_COOLDOWN_MS = 5_000;

interface UsePrimaryThreadCloudSyncOptions {
  pathname: string;
  hasHydrated: boolean;
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolvePrimaryChatArtistFromPath(
  pathname: string,
  conversations: ReturnType<typeof useStore.getState>['conversations']
): string | null {
  const chatMatch = pathname.match(/^\/chat\/([^/?#]+)/);
  if (!chatMatch?.[1]) {
    return null;
  }

  const conversationId = decodePathSegment(chatMatch[1]).trim();
  if (!conversationId) {
    return null;
  }

  const conversation = findConversationById(conversations, conversationId);
  if (!conversation) {
    return null;
  }

  return normalizeConversationThreadType(conversation.threadType) === 'primary' ? conversation.artistId : null;
}

function resolveModeSelectArtistFromPath(pathname: string): string | null {
  const modeSelectMatch = pathname.match(/^\/(?:mode-select|mode_select)\/([^/?#]+)/);
  if (!modeSelectMatch?.[1]) {
    return null;
  }
  const artistId = decodePathSegment(modeSelectMatch[1]).trim();
  return artistId || null;
}

function resolveLocalPrimaryConversationId(
  state: ReturnType<typeof useStore.getState>,
  artistId: string
): string | null {
  const conversationsForArtist = state.conversations[artistId] ?? [];
  const primaryConversation = conversationsForArtist.find(
    (conversation) => normalizeConversationThreadType(conversation.threadType) === 'primary'
  );
  return primaryConversation?.id ?? null;
}

export function usePrimaryThreadCloudSync({ pathname, hasHydrated }: UsePrimaryThreadCloudSyncOptions): void {
  const userId = useStore((state) => state.session?.user.id ?? '');
  const conversations = useStore((state) => state.conversations);
  const upsertPrimaryConversationFromCloud = useStore((state) => state.upsertPrimaryConversationFromCloud);
  const mergePrimaryMessagesFromCloud = useStore((state) => state.mergePrimaryMessagesFromCloud);
  const createConversation = useStore((state) => state.createConversation);
  const language = useStore((state) => state.language);

  const bootstrapInFlightRef = useRef(false);
  const lastBootstrapAtRef = useRef(0);
  const pullInFlightArtistsRef = useRef<Set<string>>(new Set());
  const lastPullByArtistRef = useRef<Map<string, number>>(new Map());
  const remoteThreadIndexByArtistRef = useRef<Map<string, CloudPrimaryThread>>(new Map());

  const activePrimaryArtistId = useMemo(() => {
    const modeSelectArtistId = resolveModeSelectArtistFromPath(pathname);
    if (modeSelectArtistId) {
      return modeSelectArtistId;
    }

    return resolvePrimaryChatArtistFromPath(pathname, conversations);
  }, [conversations, pathname]);

  const runBootstrap = useCallback(
    async (options?: { force?: boolean }) => {
      const normalizedUserId = userId.trim();
      if (!hasHydrated || !normalizedUserId) {
        return;
      }

      const now = Date.now();
      if (!options?.force && now - lastBootstrapAtRef.current < BOOTSTRAP_REFRESH_MS) {
        return;
      }
      if (bootstrapInFlightRef.current) {
        return;
      }

      bootstrapInFlightRef.current = true;
      try {
        const remoteThreads = await fetchPrimaryThreadIndex(normalizedUserId);
        const indexByArtist = new Map<string, CloudPrimaryThread>();
        for (const remoteThread of remoteThreads) {
          indexByArtist.set(remoteThread.artistId, remoteThread);
          upsertPrimaryConversationFromCloud(remoteThread.artistId, {
            language: remoteThread.language,
            title: remoteThread.title,
            lastMessagePreview: remoteThread.lastMessagePreview,
            updatedAt: remoteThread.updatedAt,
            createdAt: remoteThread.createdAt
          });
        }
        remoteThreadIndexByArtistRef.current = indexByArtist;
        lastBootstrapAtRef.current = Date.now();
      } catch (error) {
        if (__DEV__) {
          console.warn('[primaryThreadCloudSync] bootstrap failed', error);
        }
      } finally {
        bootstrapInFlightRef.current = false;
      }
    },
    [hasHydrated, upsertPrimaryConversationFromCloud, userId]
  );

  const pullArtistMessagesFromCloud = useCallback(
    async (artistId: string, options?: { force?: boolean }) => {
      const normalizedUserId = userId.trim();
      const normalizedArtistId = artistId.trim();
      if (!hasHydrated || !normalizedUserId || !normalizedArtistId) {
        return;
      }

      const now = Date.now();
      const lastPulledAt = lastPullByArtistRef.current.get(normalizedArtistId) ?? 0;
      if (!options?.force && now - lastPulledAt < PULL_ARTIST_COOLDOWN_MS) {
        return;
      }
      if (pullInFlightArtistsRef.current.has(normalizedArtistId)) {
        return;
      }

      pullInFlightArtistsRef.current.add(normalizedArtistId);
      try {
        let state = useStore.getState();
        let localPrimaryConversationId = resolveLocalPrimaryConversationId(state, normalizedArtistId);
        if (!localPrimaryConversationId) {
          const remoteThread = remoteThreadIndexByArtistRef.current.get(normalizedArtistId);
          if (remoteThread) {
            upsertPrimaryConversationFromCloud(normalizedArtistId, {
              language: remoteThread.language,
              title: remoteThread.title,
              lastMessagePreview: remoteThread.lastMessagePreview,
              updatedAt: remoteThread.updatedAt,
              createdAt: remoteThread.createdAt
            });
            state = useStore.getState();
            localPrimaryConversationId = resolveLocalPrimaryConversationId(state, normalizedArtistId);
          }
        }
        if (!localPrimaryConversationId) {
          localPrimaryConversationId = createConversation(normalizedArtistId, language, MODE_IDS.ON_JASE, {
            threadType: 'primary'
          }).id;
        }

        const cloudMessages = await fetchPrimaryThreadMessages(
          normalizedUserId,
          normalizedArtistId,
          PRIMARY_THREAD_CLOUD_MESSAGE_LIMIT
        );
        if (cloudMessages.length > 0 && localPrimaryConversationId) {
          mergePrimaryMessagesFromCloud(
            localPrimaryConversationId,
            cloudMessages.map((message) => ({
              id: message.id,
              role: message.role,
              content: message.content,
              timestamp: message.timestamp,
              status: message.status,
              metadata: message.metadata
            }))
          );
        }
      } catch (error) {
        if (__DEV__) {
          console.warn('[primaryThreadCloudSync] pull artist messages failed', {
            artistId: normalizedArtistId,
            error
          });
        }
      } finally {
        pullInFlightArtistsRef.current.delete(normalizedArtistId);
        lastPullByArtistRef.current.set(normalizedArtistId, Date.now());
      }
    },
    [
      createConversation,
      hasHydrated,
      language,
      mergePrimaryMessagesFromCloud,
      upsertPrimaryConversationFromCloud,
      userId
    ]
  );

  useEffect(() => {
    if (!hasHydrated || !userId.trim()) {
      return;
    }

    void runBootstrap({ force: true });
  }, [hasHydrated, runBootstrap, userId]);

  useEffect(() => {
    const normalizedArtistId = activePrimaryArtistId?.trim() ?? '';
    if (!hasHydrated || !userId.trim() || !normalizedArtistId) {
      return;
    }

    void pullArtistMessagesFromCloud(normalizedArtistId);
  }, [activePrimaryArtistId, hasHydrated, pullArtistMessagesFromCloud, userId]);

  useEffect(() => {
    if (!hasHydrated || !userId.trim()) {
      return;
    }

    const refreshFromFocus = () => {
      void runBootstrap({ force: true });
      const normalizedArtistId = activePrimaryArtistId?.trim() ?? '';
      if (normalizedArtistId) {
        void pullArtistMessagesFromCloud(normalizedArtistId, { force: true });
      }
    };

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        refreshFromFocus();
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    const handleWindowFocus = () => {
      refreshFromFocus();
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refreshFromFocus();
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined') {
      window.addEventListener('focus', handleWindowFocus);
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      appStateSubscription.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined') {
        window.removeEventListener('focus', handleWindowFocus);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [
    activePrimaryArtistId,
    hasHydrated,
    pullArtistMessagesFromCloud,
    runBootstrap,
    userId
  ]);
}
