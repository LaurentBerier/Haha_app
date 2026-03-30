import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import type { Message } from '../models/Message';
import type { AudioPlayerController } from './useAudioPlayer';
import { findLatestReplayableArtistMessage, shouldReplayArtistMessage } from '../utils/voiceReplay';

interface UseAutoReplayLastArtistMessageParams {
  messages: Message[];
  audioPlayer: AudioPlayerController;
  enabled: boolean;
  hasStreaming: boolean;
  voiceAutoPlay?: boolean;
  replayOnFocus?: boolean;
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

  const attemptReplay = useCallback(() => {
    if (!canAutoReplayArtistMessage(enabled, voiceAutoPlay) || hasStreaming || audioPlayer.isPlaying || audioPlayer.isLoading) {
      return;
    }

    const latestReplayable = findLatestReplayableArtistMessage(messages);
    if (!latestReplayable) {
      return;
    }
    if (!shouldReplayArtistMessage(lastReplayedMessageIdRef.current, latestReplayable)) {
      return;
    }

    lastReplayedMessageIdRef.current = latestReplayable.messageId;
    void audioPlayer.playQueue(latestReplayable.uris, {
      messageId: latestReplayable.messageId
    });
  }, [audioPlayer, enabled, hasStreaming, messages, voiceAutoPlay]);

  useEffect(() => {
    if (!canAutoReplayArtistMessage(enabled, voiceAutoPlay)) {
      hasRunInitialReplayRef.current = false;
      return;
    }

    if (hasRunInitialReplayRef.current) {
      return;
    }

    if (!findLatestReplayableArtistMessage(messages)) {
      return;
    }

    hasRunInitialReplayRef.current = true;
    attemptReplay();
  }, [attemptReplay, enabled, messages, voiceAutoPlay]);

  useEffect(() => {
    if (!shouldReplayOnFocusLifecycle(enabled, replayOnFocus, voiceAutoPlay)) {
      return;
    }

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        attemptReplay();
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
    const handleWindowFocus = () => {
      attemptReplay();
    };
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        attemptReplay();
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
  }, [attemptReplay, enabled, replayOnFocus, voiceAutoPlay]);
}
