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
}

export function useAutoReplayLastArtistMessage({
  messages,
  audioPlayer,
  enabled,
  hasStreaming
}: UseAutoReplayLastArtistMessageParams): void {
  const hasRunInitialReplayRef = useRef(false);
  const lastReplayedMessageIdRef = useRef<string | null>(null);

  const attemptReplay = useCallback(() => {
    if (!enabled || hasStreaming || audioPlayer.isPlaying || audioPlayer.isLoading) {
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
  }, [audioPlayer, enabled, hasStreaming, messages]);

  useEffect(() => {
    if (!enabled) {
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
  }, [attemptReplay, enabled, messages]);

  useEffect(() => {
    if (!enabled) {
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
  }, [attemptReplay, enabled]);
}
