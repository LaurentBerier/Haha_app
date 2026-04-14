import { Audio, type AVPlaybackStatus } from 'expo-av';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { markWebAutoplaySessionUnlocked } from '../services/webAutoplayUnlockService';

interface WebAudioLike {
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener: (event: string, handler: () => void) => void;
  pause: () => void;
  play: () => Promise<void>;
  src: string;
  volume: number;
}

export type AudioPlaybackFailureReason = 'invalid_queue' | 'web_autoplay_blocked' | 'playback_error' | 'interrupted';

export interface AudioPlaybackResult {
  started: boolean;
  reason: AudioPlaybackFailureReason | null;
}

export interface AudioPlayerController {
  isPlaying: boolean;
  isLoading: boolean;
  currentUri: string | null;
  currentMessageId: string | null;
  currentIndex: number;
  totalChunks: number;
  play: (uri: string, context?: AudioPlaybackContext) => Promise<AudioPlaybackResult>;
  playQueue: (uris: string[], context?: AudioPlaybackContext) => Promise<AudioPlaybackResult>;
  appendToQueue: (uri: string, context?: AudioPlaybackContext) => void;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  /** Let the current audio chunk finish before stopping. Use instead of stop() when
   *  interrupting Cathy mid-reply so she doesn't cut off mid-word. */
  gracefulStop: () => void;
}

export interface AudioPlaybackContext {
  messageId?: string | null;
}

interface AudioPlaybackQueueItem {
  uri: string;
  messageId: string | null;
}

function isLoadedStatus(status: AVPlaybackStatus): status is AVPlaybackStatus & { isLoaded: true } {
  return status.isLoaded;
}

const PLAYBACK_STARTED_RESULT: AudioPlaybackResult = {
  started: true,
  reason: null
};

function toPlaybackFailureResult(reason: AudioPlaybackFailureReason): AudioPlaybackResult {
  return {
    started: false,
    reason
  };
}

export function isWebAutoplayBlockedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  return name === 'NotAllowedError';
}

function isWebAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  return name === 'AbortError';
}

export function resolveAudioPlaybackFailureReason(error: unknown): AudioPlaybackFailureReason {
  if (isWebAutoplayBlockedError(error)) {
    return 'web_autoplay_blocked';
  }
  if (Platform.OS === 'web' && isWebAbortError(error)) {
    return 'interrupted';
  }
  return 'playback_error';
}

let persistentWebAudio: WebAudioLike | null = null;

function getOrCreatePersistentWebAudio(): WebAudioLike | null {
  if (persistentWebAudio) {
    return persistentWebAudio;
  }
  const WebAudioCtor = (globalThis as { Audio?: new () => WebAudioLike }).Audio;
  if (!WebAudioCtor) {
    return null;
  }
  persistentWebAudio = new WebAudioCtor();
  return persistentWebAudio;
}

export function useAudioPlayer(): AudioPlayerController {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentUri, setCurrentUri] = useState<string | null>(null);
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);

  const soundRef = useRef<Audio.Sound | null>(null);
  const webAudioRef = useRef<WebAudioLike | null>(null);
  const detachWebListenersRef = useRef<null | (() => void)>(null);
  const queueRef = useRef<AudioPlaybackQueueItem[]>([]);
  const queueIndexRef = useRef(0);
  const playbackTokenRef = useRef(0);
  const isMountedRef = useRef(true);
  const isGracefullyStoppingRef = useRef(false);

  const clearWebListeners = useCallback(() => {
    detachWebListenersRef.current?.();
    detachWebListenersRef.current = null;
  }, []);

  const releaseWebAudio = useCallback(() => {
    clearWebListeners();
    const audio = webAudioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
      // Force iOS Safari to release the audio session so the mic can reclaim it
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof (audio as any).load === 'function') (audio as any).load();
    }
    webAudioRef.current = null;
  }, [clearWebListeners]);

  const releaseNativeAudio = useCallback(async () => {
    if (!soundRef.current) {
      return;
    }

    const sound = soundRef.current;
    soundRef.current = null;
    sound.setOnPlaybackStatusUpdate(null);
    try {
      await sound.stopAsync();
    } catch {
      // noop
    }
    try {
      await sound.unloadAsync();
    } catch {
      // noop
    }
  }, []);

  const releaseAllAudio = useCallback(async () => {
    releaseWebAudio();
    await releaseNativeAudio();
  }, [releaseNativeAudio, releaseWebAudio]);

  const resetState = useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }
    setIsPlaying(false);
    setIsLoading(false);
    setCurrentUri(null);
    setCurrentMessageId(null);
    setCurrentIndex(0);
    setTotalChunks(0);
  }, []);

  const stop = useCallback(async () => {
    isGracefullyStoppingRef.current = false;
    playbackTokenRef.current += 1;
    queueRef.current = [];
    queueIndexRef.current = 0;
    await releaseAllAudio();
    // #region agent log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if(typeof window!=='undefined'){((window as any).__dbg=((window as any).__dbg||[])).push({t:Date.now(),l:'audioPlayer:stop',d:{newToken:playbackTokenRef.current,mounted:isMountedRef.current}});console.warn('[DBG]stop',{tok:playbackTokenRef.current});}
    // #endregion
    resetState();
  }, [releaseAllAudio, resetState]);

  const playQueue = useCallback(
    async (uris: string[], context?: AudioPlaybackContext) => {
      const nextQueue = uris
        .map((uri) => uri.trim())
        .filter(Boolean)
        .map((uri) => ({
          uri,
          messageId: context?.messageId ?? null
        }));
      if (nextQueue.length === 0) {
        return toPlaybackFailureResult('invalid_queue');
      }

      const token = playbackTokenRef.current + 1;
      playbackTokenRef.current = token;
      queueRef.current = nextQueue;
      queueIndexRef.current = 0;

      await releaseAllAudio();

      const playIndex = async (index: number): Promise<AudioPlaybackResult> => {
        if (!isMountedRef.current || playbackTokenRef.current !== token) {
          return toPlaybackFailureResult('interrupted');
        }

        await releaseAllAudio();

        if (!isMountedRef.current || playbackTokenRef.current !== token) {
          return toPlaybackFailureResult('interrupted');
        }

        const queue = queueRef.current;
        const queueItem = queue[index];
        if (!queueItem?.uri) {
          await stop();
          return toPlaybackFailureResult('invalid_queue');
        }
        const uri = queueItem.uri;

        queueIndexRef.current = index;
        setCurrentUri(uri);
        setCurrentMessageId(queueItem.messageId);
        setCurrentIndex(index);
        setTotalChunks(queue.length);
        setIsLoading(true);
        setIsPlaying(false);
        // #region agent log
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if(typeof window!=='undefined'){((window as any).__dbg=((window as any).__dbg||[])).push({t:Date.now(),l:'audioPlayer:playIndex',d:{index,token,uri:uri.slice(0,60),mid:queueItem.messageId,qLen:queue.length}});console.warn('[DBG]playIndex',{index,token,uri:uri.slice(0,60),mid:queueItem.messageId});}
        // #endregion

        const onChunkEnd = () => {
          if (!isMountedRef.current || playbackTokenRef.current !== token) {
            return;
          }

          // Graceful stop: finish the current chunk, then halt without advancing.
          if (isGracefullyStoppingRef.current) {
            isGracefullyStoppingRef.current = false;
            void stop();
            return;
          }

          const nextIndex = queueIndexRef.current + 1;
          if (nextIndex >= queueRef.current.length) {
            void stop();
            return;
          }

          void playIndex(nextIndex);
        };

        if (Platform.OS === 'web') {
          const webAudio = getOrCreatePersistentWebAudio();
          if (!webAudio) {
            await stop();
            return toPlaybackFailureResult('playback_error');
          }

          webAudio.src = uri;
          webAudio.volume = 1;
          webAudioRef.current = webAudio;

          const handleEnded = () => onChunkEnd();
          const handlePlaying = () => {
            if (!isMountedRef.current || playbackTokenRef.current !== token) {
              return;
            }
            setIsLoading(false);
            setIsPlaying(true);
          };
          const handlePause = () => {
            if (!isMountedRef.current || playbackTokenRef.current !== token) {
              return;
            }
            if (Platform.OS === 'web' && queueIndexRef.current >= queueRef.current.length - 1) {
              webAudio.src = '';
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              if (typeof (webAudio as any).load === 'function') (webAudio as any).load();
            }
            setIsPlaying(false);
          };
          const handleError = () => {
            onChunkEnd();
          };

          clearWebListeners();
          webAudio.addEventListener('ended', handleEnded);
          webAudio.addEventListener('playing', handlePlaying);
          webAudio.addEventListener('pause', handlePause);
          webAudio.addEventListener('error', handleError);
          detachWebListenersRef.current = () => {
            webAudio.removeEventListener('ended', handleEnded);
            webAudio.removeEventListener('playing', handlePlaying);
            webAudio.removeEventListener('pause', handlePause);
            webAudio.removeEventListener('error', handleError);
          };

          try {
            await webAudio.play();
            // #region agent log
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if(typeof window!=='undefined'){((window as any).__dbg=((window as any).__dbg||[])).push({t:Date.now(),l:'audioPlayer:playOK',d:{token,uri:uri.slice(0,60),mid:queueItem.messageId}});console.warn('[DBG]playOK',{token,mid:queueItem.messageId});}
            // #endregion
            if (isMountedRef.current && playbackTokenRef.current === token) {
              setIsLoading(false);
              setIsPlaying(true);
            }
            markWebAutoplaySessionUnlocked();
            return PLAYBACK_STARTED_RESULT;
          } catch (error: unknown) {
            const reason = resolveAudioPlaybackFailureReason(error);
            // #region agent log
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if(typeof window!=='undefined'){((window as any).__dbg=((window as any).__dbg||[])).push({t:Date.now(),l:'audioPlayer:playERR',d:{token,reason,eName:(error as any)?.name,eMsg:(error as any)?.message?.slice(0,100)}});console.warn('[DBG]playERR',{token,reason,eName:(error as any)?.name});}
            // #endregion
            if (reason === 'web_autoplay_blocked') {
              await stop();
              return toPlaybackFailureResult(reason);
            }
            if (reason === 'interrupted' || playbackTokenRef.current !== token) {
              return toPlaybackFailureResult('interrupted');
            }
            onChunkEnd();
            return toPlaybackFailureResult(reason);
          }
        }

        try {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            interruptionModeIOS: 1,
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
            shouldDuckAndroid: false,
            interruptionModeAndroid: 1,
            playThroughEarpieceAndroid: false
          });
        } catch {
          // First attempt may fail if a recording session is still releasing.
          // Yield briefly and retry once so iOS routes audio to the loudspeaker.
          await new Promise<void>((r) => setTimeout(r, 80));
          try {
            await Audio.setAudioModeAsync({
              allowsRecordingIOS: false,
              interruptionModeIOS: 1,
              playsInSilentModeIOS: true,
              staysActiveInBackground: false,
              shouldDuckAndroid: false,
              interruptionModeAndroid: 1,
              playThroughEarpieceAndroid: false
            });
          } catch {
            // give up
          }
        }

        const sound = new Audio.Sound();
        soundRef.current = sound;

        sound.setOnPlaybackStatusUpdate((status) => {
          if (!isMountedRef.current || playbackTokenRef.current !== token) {
            return;
          }

          if (!isLoadedStatus(status)) {
            if (status.error) {
              onChunkEnd();
            }
            return;
          }

          setIsLoading(false);
          setIsPlaying(status.isPlaying);

          if (status.didJustFinish) {
            onChunkEnd();
          }
        });

        try {
          await sound.loadAsync({ uri }, { shouldPlay: true, volume: 1 }, true);
          try {
            await sound.setVolumeAsync(1);
          } catch {
            // Best effort.
          }
          if (!isMountedRef.current || playbackTokenRef.current !== token) {
            return toPlaybackFailureResult('interrupted');
          }

          if (isMountedRef.current && playbackTokenRef.current === token) {
            setIsLoading(false);
            setIsPlaying(true);
          }
          return PLAYBACK_STARTED_RESULT;
        } catch (error: unknown) {
          const reason = resolveAudioPlaybackFailureReason(error);
          onChunkEnd();
          return toPlaybackFailureResult(reason);
        }
      };

      return playIndex(0);
    },
    [clearWebListeners, releaseAllAudio, stop]
  );

  const gracefulStop = useCallback(() => {
    // Signal onChunkEnd to stop after the current chunk finishes rather than
    // advancing to the next one. This prevents Cathy from cutting off mid-word.
    isGracefullyStoppingRef.current = true;
  }, []);

  const play = useCallback(async (uri: string, context?: AudioPlaybackContext) => {
    return playQueue([uri], context);
  }, [playQueue]);

  const appendToQueue = useCallback(
    (uri: string, context?: AudioPlaybackContext) => {
      const trimmed = uri.trim();
      if (!trimmed) {
        return;
      }

      if (queueRef.current.length > 0) {
        queueRef.current.push({
          uri: trimmed,
          messageId: context?.messageId ?? null
        });
        if (isMountedRef.current) {
          setTotalChunks(queueRef.current.length);
        }
        return;
      }

      void playQueue([trimmed], context);
    },
    [playQueue]
  );

  const pause = useCallback(async () => {
    if (Platform.OS === 'web') {
      webAudioRef.current?.pause();
      if (isMountedRef.current) {
        setIsPlaying(false);
      }
      return;
    }

    const sound = soundRef.current;
    if (!sound) {
      return;
    }

    try {
      const status = await sound.getStatusAsync();
      if (isLoadedStatus(status) && status.isPlaying) {
        await sound.pauseAsync();
      }
    } catch {
      // noop
    }

    if (isMountedRef.current) {
      setIsPlaying(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      void stop();
    };
  }, [stop]);

  return {
    isPlaying,
    isLoading,
    currentUri,
    currentMessageId,
    currentIndex,
    totalChunks,
    play,
    playQueue,
    appendToQueue,
    pause,
    stop,
    gracefulStop
  };
}
