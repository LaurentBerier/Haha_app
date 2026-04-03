import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import type { Message } from '../models/Message';
import type { AudioPlayerController } from './useAudioPlayer';
import { attemptVoiceAutoplayQueue, type VoiceAutoplayAttemptState } from '../services/voiceAutoplayService';
import {
  findLatestReplayableArtistMessage,
  findReplayableArtistMessageById,
  shouldReplayArtistMessage,
  type ReplayableArtistMessage
} from '../utils/voiceReplay';

interface UseAutoReplayLastArtistMessageParams {
  messages: Message[];
  audioPlayer: AudioPlayerController;
  enabled: boolean;
  hasStreaming: boolean;
  voiceAutoPlay?: boolean;
  replayOnFocus?: boolean;
}

interface AttemptReplayOptions {
  messageId?: string | null;
  allowReplayOfSameMessage?: boolean;
}

export type PendingReplayStatus = 'pending_blockers' | 'pending_web_unlock';
export type ReplayAttemptStatus = PendingReplayStatus | VoiceAutoplayAttemptState | 'failed';

export interface PendingReplayState {
  messageId: string;
  status: PendingReplayStatus;
}

interface ResolveInterruptedReplayMessageIdParams {
  nextState: AppStateStatus;
  isAudioActive: boolean;
  currentMessageId: string | null | undefined;
}

export function canAutoReplayArtistMessage(enabled: boolean, voiceAutoPlay: boolean): boolean {
  return enabled && voiceAutoPlay;
}

export function shouldReplayOnFocusLifecycle(
  enabled: boolean,
  replayOnFocus: boolean,
  voiceAutoPlay: boolean
): boolean {
  return canAutoReplayArtistMessage(enabled, voiceAutoPlay) && replayOnFocus;
}

export function resolveInterruptedReplayMessageId({
  nextState,
  isAudioActive,
  currentMessageId
}: ResolveInterruptedReplayMessageIdParams): string | null {
  if (nextState === 'active' || !isAudioActive) {
    return null;
  }

  const normalizedMessageId = typeof currentMessageId === 'string' ? currentMessageId.trim() : '';
  return normalizedMessageId || null;
}

export function shouldAttemptInterruptedReplayOnAppActive(
  nextState: AppStateStatus,
  interruptedMessageId: string | null
): boolean {
  if (nextState !== 'active') {
    return false;
  }

  const normalizedMessageId = typeof interruptedMessageId === 'string' ? interruptedMessageId.trim() : '';
  return normalizedMessageId.length > 0;
}

export function resolveReplayTrackingStateAfterAttempt(
  previousLastStartedMessageId: string | null,
  messageId: string,
  status: ReplayAttemptStatus
): {
  nextLastStartedMessageId: string | null;
  nextPendingReplay: PendingReplayState | null;
} {
  if (status === 'started') {
    return {
      nextLastStartedMessageId: messageId,
      nextPendingReplay: null
    };
  }

  if (status === 'pending_blockers' || status === 'pending_web_unlock') {
    return {
      nextLastStartedMessageId: previousLastStartedMessageId,
      nextPendingReplay: {
        messageId,
        status
      }
    };
  }

  return {
    nextLastStartedMessageId: previousLastStartedMessageId,
    nextPendingReplay: null
  };
}

export function shouldRetryPendingReplayWhenUnblocked(params: {
  pendingReplay: PendingReplayState | null;
  hasStreaming: boolean;
  isPlaying: boolean;
  isLoading: boolean;
}): boolean {
  if (!params.pendingReplay || params.pendingReplay.status !== 'pending_blockers') {
    return false;
  }

  return !params.hasStreaming && !params.isPlaying && !params.isLoading;
}

export function useAutoReplayLastArtistMessage({
  messages,
  audioPlayer,
  enabled,
  hasStreaming,
  voiceAutoPlay = true,
  replayOnFocus = true
}: UseAutoReplayLastArtistMessageParams): void {
  const hasRunInitialReplayRef = useRef(false);
  const lastStartedReplayMessageIdRef = useRef<string | null>(null);
  const interruptedReplayMessageIdRef = useRef<string | null>(null);
  const pendingReplayRef = useRef<PendingReplayState | null>(null);
  const attemptReplayRef = useRef<(options?: AttemptReplayOptions) => Promise<ReplayAttemptStatus>>(async () => 'failed');

  const resolveReplayableMessage = useCallback(
    (targetMessageId?: string | null): ReplayableArtistMessage | null => {
      if (targetMessageId) {
        return findReplayableArtistMessageById(messages, targetMessageId);
      }
      return findLatestReplayableArtistMessage(messages);
    },
    [messages]
  );

  const attemptReplay = useCallback(async (options?: AttemptReplayOptions): Promise<ReplayAttemptStatus> => {
    if (!canAutoReplayArtistMessage(enabled, voiceAutoPlay)) {
      pendingReplayRef.current = null;
      return 'failed';
    }

    const latestReplayable = resolveReplayableMessage(options?.messageId);
    if (!latestReplayable) {
      if (options?.messageId) {
        pendingReplayRef.current = null;
      }
      return 'failed';
    }

    const shouldBypassReplayGuard = Boolean(options?.allowReplayOfSameMessage);
    if (!shouldBypassReplayGuard && !shouldReplayArtistMessage(lastStartedReplayMessageIdRef.current, latestReplayable)) {
      pendingReplayRef.current = null;
      return 'failed';
    }

    if (hasStreaming || audioPlayer.isPlaying || audioPlayer.isLoading) {
      const trackingState = resolveReplayTrackingStateAfterAttempt(
        lastStartedReplayMessageIdRef.current,
        latestReplayable.messageId,
        'pending_blockers'
      );
      lastStartedReplayMessageIdRef.current = trackingState.nextLastStartedMessageId;
      pendingReplayRef.current = trackingState.nextPendingReplay;
      return 'pending_blockers';
    }

    const autoplayState = await attemptVoiceAutoplayQueue({
      audioPlayer,
      uris: latestReplayable.uris,
      messageId: latestReplayable.messageId,
      onWebUnlockRetry: () => {
        void attemptReplayRef.current({
          messageId: latestReplayable.messageId,
          allowReplayOfSameMessage: true
        });
      }
    });

    const trackingState = resolveReplayTrackingStateAfterAttempt(
      lastStartedReplayMessageIdRef.current,
      latestReplayable.messageId,
      autoplayState
    );
    lastStartedReplayMessageIdRef.current = trackingState.nextLastStartedMessageId;
    pendingReplayRef.current = trackingState.nextPendingReplay;
    return autoplayState;
  }, [audioPlayer, enabled, hasStreaming, resolveReplayableMessage, voiceAutoPlay]);

  useEffect(() => {
    attemptReplayRef.current = attemptReplay;
  }, [attemptReplay]);

  useEffect(() => {
    if (!canAutoReplayArtistMessage(enabled, voiceAutoPlay)) {
      hasRunInitialReplayRef.current = false;
      lastStartedReplayMessageIdRef.current = null;
      interruptedReplayMessageIdRef.current = null;
      pendingReplayRef.current = null;
      return;
    }

    if (hasRunInitialReplayRef.current) {
      return;
    }

    if (!resolveReplayableMessage()) {
      return;
    }

    hasRunInitialReplayRef.current = true;
    void attemptReplayRef.current();
  }, [enabled, resolveReplayableMessage, voiceAutoPlay]);

  useEffect(() => {
    if (!canAutoReplayArtistMessage(enabled, voiceAutoPlay)) {
      return;
    }

    if (
      !shouldRetryPendingReplayWhenUnblocked({
        pendingReplay: pendingReplayRef.current,
        hasStreaming,
        isPlaying: audioPlayer.isPlaying,
        isLoading: audioPlayer.isLoading
      })
    ) {
      return;
    }

    const pendingReplay = pendingReplayRef.current;
    if (!pendingReplay) {
      return;
    }

    void attemptReplayRef.current({
      messageId: pendingReplay.messageId,
      allowReplayOfSameMessage: true
    });
  }, [audioPlayer.isLoading, audioPlayer.isPlaying, enabled, hasStreaming, voiceAutoPlay]);

  useEffect(() => {
    if (Platform.OS === 'web' || !canAutoReplayArtistMessage(enabled, voiceAutoPlay)) {
      return;
    }

    const handleAppStateChange = (nextState: AppStateStatus) => {
      const interruptedReplayMessageId = resolveInterruptedReplayMessageId({
        nextState,
        isAudioActive: audioPlayer.isPlaying || audioPlayer.isLoading,
        currentMessageId: audioPlayer.currentMessageId
      });
      if (interruptedReplayMessageId) {
        interruptedReplayMessageIdRef.current = interruptedReplayMessageId;
        return;
      }

      if (nextState === 'active') {
        void (async () => {
          if (shouldAttemptInterruptedReplayOnAppActive(nextState, interruptedReplayMessageIdRef.current)) {
            const queuedInterruptedMessageId = interruptedReplayMessageIdRef.current?.trim() ?? '';
            interruptedReplayMessageIdRef.current = null;
            if (queuedInterruptedMessageId) {
              const replayState = await attemptReplayRef.current({
                messageId: queuedInterruptedMessageId,
                allowReplayOfSameMessage: true
              });
              if (replayState === 'started' || replayState === 'pending_blockers' || replayState === 'pending_web_unlock') {
                return;
              }
            }
          }

          const pendingReplayMessageId = pendingReplayRef.current?.messageId?.trim() ?? '';
          if (pendingReplayMessageId) {
            await attemptReplayRef.current({
              messageId: pendingReplayMessageId,
              allowReplayOfSameMessage: true
            });
            return;
          }

          if (replayOnFocus) {
            await attemptReplayRef.current();
          }
        })();
        return;
      }

    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      appStateSubscription.remove();
    };
  }, [
    audioPlayer.currentMessageId,
    audioPlayer.isLoading,
    audioPlayer.isPlaying,
    enabled,
    replayOnFocus,
    voiceAutoPlay
  ]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !shouldReplayOnFocusLifecycle(enabled, replayOnFocus, voiceAutoPlay)) {
      return;
    }

    const replayPendingOrLatest = () => {
      const pendingReplayMessageId = pendingReplayRef.current?.messageId?.trim() ?? '';
      if (pendingReplayMessageId) {
        void attemptReplayRef.current({
          messageId: pendingReplayMessageId,
          allowReplayOfSameMessage: true
        });
        return;
      }

      void attemptReplayRef.current();
    };

    const handleWindowFocus = () => {
      replayPendingOrLatest();
    };
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        replayPendingOrLatest();
      }
    };

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      window.addEventListener('focus', handleWindowFocus);
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        window.removeEventListener('focus', handleWindowFocus);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [enabled, replayOnFocus, voiceAutoPlay]);
}
