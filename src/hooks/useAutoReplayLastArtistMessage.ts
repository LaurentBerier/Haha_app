import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import type { Message } from '../models/Message';
import type { AudioPlayerController } from './useAudioPlayer';
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

export function useAutoReplayLastArtistMessage({
  messages,
  audioPlayer,
  enabled,
  hasStreaming,
  voiceAutoPlay = true,
  replayOnFocus = true
}: UseAutoReplayLastArtistMessageParams): void {
  const hasRunInitialReplayRef = useRef(false);
  const lastReplayedMessageIdRef = useRef<string | null>(null);
  const interruptedReplayMessageIdRef = useRef<string | null>(null);

  const resolveReplayableMessage = useCallback(
    (targetMessageId?: string | null): ReplayableArtistMessage | null => {
      if (targetMessageId) {
        return findReplayableArtistMessageById(messages, targetMessageId);
      }
      return findLatestReplayableArtistMessage(messages);
    },
    [messages]
  );

  const attemptReplay = useCallback((options?: AttemptReplayOptions): boolean => {
    if (!canAutoReplayArtistMessage(enabled, voiceAutoPlay) || hasStreaming || audioPlayer.isPlaying || audioPlayer.isLoading) {
      return false;
    }

    const latestReplayable = resolveReplayableMessage(options?.messageId);
    if (!latestReplayable) {
      return false;
    }

    const shouldBypassReplayGuard = Boolean(options?.allowReplayOfSameMessage);
    if (!shouldBypassReplayGuard && !shouldReplayArtistMessage(lastReplayedMessageIdRef.current, latestReplayable)) {
      return false;
    }

    lastReplayedMessageIdRef.current = latestReplayable.messageId;
    void audioPlayer.playQueue(latestReplayable.uris, {
      messageId: latestReplayable.messageId
    });
    return true;
  }, [audioPlayer, enabled, hasStreaming, resolveReplayableMessage, voiceAutoPlay]);

  useEffect(() => {
    if (!canAutoReplayArtistMessage(enabled, voiceAutoPlay)) {
      hasRunInitialReplayRef.current = false;
      interruptedReplayMessageIdRef.current = null;
      return;
    }

    if (hasRunInitialReplayRef.current) {
      return;
    }

    if (!resolveReplayableMessage()) {
      return;
    }

    hasRunInitialReplayRef.current = true;
    attemptReplay();
  }, [attemptReplay, enabled, resolveReplayableMessage, voiceAutoPlay]);

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

      if (shouldAttemptInterruptedReplayOnAppActive(nextState, interruptedReplayMessageIdRef.current)) {
        const queuedInterruptedMessageId = interruptedReplayMessageIdRef.current?.trim() ?? '';
        if (!resolveReplayableMessage(queuedInterruptedMessageId)) {
          interruptedReplayMessageIdRef.current = null;
        } else if (
          attemptReplay({
            messageId: queuedInterruptedMessageId,
            allowReplayOfSameMessage: true
          })
        ) {
          interruptedReplayMessageIdRef.current = null;
          return;
        }
      }

      if (nextState === 'active' && replayOnFocus) {
        attemptReplay();
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      appStateSubscription.remove();
    };
  }, [
    attemptReplay,
    audioPlayer.currentMessageId,
    audioPlayer.isLoading,
    audioPlayer.isPlaying,
    enabled,
    replayOnFocus,
    resolveReplayableMessage,
    voiceAutoPlay
  ]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !shouldReplayOnFocusLifecycle(enabled, replayOnFocus, voiceAutoPlay)) {
      return;
    }

    const handleWindowFocus = () => {
      attemptReplay();
    };
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        attemptReplay();
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
  }, [attemptReplay, enabled, replayOnFocus, voiceAutoPlay]);
}
