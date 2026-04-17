import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { markWebAutoplaySessionUnlocked } from '../services/webAutoplayUnlockService';
import { sttDebug } from '../services/sttDebugLogger';
import { markAudioSessionRecordingReady, markAudioSessionPlaybackMode } from '../services/audioSessionState';
import { isIosMobileWebRuntime } from '../platform/platformCapabilities';

interface WebAudioLike {
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener: (event: string, handler: () => void) => void;
  pause: () => void;
  play: () => Promise<void>;
  src: string;
  volume: number;
}

interface NativeAudioStatus {
  isLoaded: boolean;
  playing: boolean;
  didJustFinish?: boolean;
}

interface NativeAudioPlayer {
  volume: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  remove: () => void;
  addListener: (
    eventName: 'playbackStatusUpdate',
    listener: (status: NativeAudioStatus) => void
  ) => { remove: () => void };
}

interface ExpoAudioModuleLike {
  createAudioPlayer: (source: { uri: string }) => NativeAudioPlayer;
  setAudioModeAsync: (mode: {
    allowsRecording: boolean;
    interruptionMode: 'doNotMix';
    playsInSilentMode: boolean;
    shouldPlayInBackground: boolean;
    interruptionModeAndroid: 'doNotMix';
    shouldRouteThroughEarpiece: boolean;
  }) => Promise<void>;
}

let expoAudioModulePromise: Promise<ExpoAudioModuleLike | null> | null = null;

async function loadExpoAudioModule(): Promise<ExpoAudioModuleLike | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  if (!expoAudioModulePromise) {
    expoAudioModulePromise = import('expo-audio')
      .then((module) => module as ExpoAudioModuleLike)
      .catch(() => null);
  }
  return expoAudioModulePromise;
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
  /** Register a callback that fires synchronously when the audio queue finishes
   *  naturally (last chunk ends). Fires *before* the React state update from stop(),
   *  so consumers can begin work (e.g. STT restart) without waiting for a re-render. */
  onQueueCompleteRef: React.RefObject<(() => void) | null>;
}

export interface AudioPlaybackContext {
  messageId?: string | null;
}

interface AudioPlaybackQueueItem {
  uri: string;
  messageId: string | null;
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

const IS_IOS_MOBILE_WEB = isIosMobileWebRuntime();
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

/** Destroy the persistent <audio> element so iOS Safari fully releases the
 *  audio route. The next TTS call will create a fresh element via
 *  getOrCreatePersistentWebAudio(). iOS Safari's tab-level autoplay unlock
 *  survives element destruction, so subsequent play() calls still work. */
function destroyPersistentWebAudio(): void {
  if (!persistentWebAudio) {
    return;
  }
  try {
    persistentWebAudio.pause();
    persistentWebAudio.src = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = persistentWebAudio as any;
    if (typeof el.load === 'function') el.load();
    if (typeof el.remove === 'function') el.remove();
  } catch {
    // noop
  }
  persistentWebAudio = null;
  sttDebug('[STT_DEBUG] destroyPersistentWebAudio: element destroyed');
}

export function useAudioPlayer(): AudioPlayerController {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentUri, setCurrentUri] = useState<string | null>(null);
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);

  const soundRef = useRef<NativeAudioPlayer | null>(null);
  const nativeSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const webAudioRef = useRef<WebAudioLike | null>(null);
  const detachWebListenersRef = useRef<null | (() => void)>(null);
  const queueRef = useRef<AudioPlaybackQueueItem[]>([]);
  const queueIndexRef = useRef(0);
  const playbackTokenRef = useRef(0);
  const isMountedRef = useRef(true);
  const isGracefullyStoppingRef = useRef(false);
  const onQueueCompleteRef = useRef<(() => void) | null>(null);

  const clearWebListeners = useCallback(() => {
    detachWebListenersRef.current?.();
    detachWebListenersRef.current = null;
  }, []);

  const releaseWebAudio = useCallback((forMicReclaim = false) => {
    clearWebListeners();
    const audio = webAudioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
      // Only call load() when we need to release the audio session for STT mic reclaim.
      // Calling load() between chunks kills the autoplay-unlock state on iOS Safari,
      // causing subsequent play() calls to fail with NotAllowedError.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (forMicReclaim && typeof (audio as any).load === 'function') {
        (audio as any).load();
      }
    }
    webAudioRef.current = null;
    // On iOS Safari, destroy the persistent <audio> element entirely when
    // reclaiming the mic for STT. Just pause()+load() leaves the audio route
    // held by the element, preventing the speech recognizer from receiving audio
    // (onaudiostart fires but onspeechstart never does).
    if (forMicReclaim && IS_IOS_MOBILE_WEB) {
      destroyPersistentWebAudio();
    }
  }, [clearWebListeners]);

  const releaseNativePlayer = useCallback(() => {
    if (!soundRef.current) {
      return;
    }
    const player = soundRef.current;
    soundRef.current = null;
    nativeSubscriptionRef.current?.remove();
    nativeSubscriptionRef.current = null;
    try {
      player.remove();
    } catch {
      // noop
    }
  }, []);

  const releaseNativeAudio = useCallback(async () => {
    if (!soundRef.current) {
      return;
    }

    const player = soundRef.current;
    soundRef.current = null;
    nativeSubscriptionRef.current?.remove();
    nativeSubscriptionRef.current = null;
    try {
      player.remove();
    } catch {
      // noop
    }

    // Restore audio session to allow recording so STT can reclaim the mic
    if (Platform.OS === 'ios') {
      try {
        sttDebug('[STT_DEBUG] releaseNativeAudio: restoring allowsRecording=true');
        const audioModule = await loadExpoAudioModule();
        if (audioModule) {
          await audioModule.setAudioModeAsync({
            allowsRecording: true,
            interruptionMode: 'doNotMix',
            playsInSilentMode: true,
            shouldPlayInBackground: false,
            interruptionModeAndroid: 'doNotMix',
            shouldRouteThroughEarpiece: false
          });
          markAudioSessionRecordingReady();
          sttDebug('[STT_DEBUG] releaseNativeAudio: allowsRecording=true RESTORED');
        }
      } catch (err) {
        sttDebug('[STT_DEBUG] releaseNativeAudio: allowsRecording restore FAILED -', err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  const releaseAllAudio = useCallback(async (forMicReclaim = false) => {
    releaseWebAudio(forMicReclaim);
    await releaseNativeAudio();
  }, [releaseNativeAudio, releaseWebAudio]);

  const releaseCurrentPlayers = useCallback(() => {
    releaseWebAudio();
    releaseNativePlayer();
  }, [releaseWebAudio, releaseNativePlayer]);

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
    await releaseAllAudio(true);  // Queue done — let STT reclaim mic via load()
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

      await releaseAllAudio(false);  // New queue starting — preserve autoplay unlock

      // Set audio session to playback mode ONCE for the entire queue.
      // This avoids per-chunk flip-flopping between allowsRecording true/false
      // which causes iOS audio dropout between TTS chunks.
      if (Platform.OS !== 'web') {
        const expoAudioModule = await loadExpoAudioModule();
        if (expoAudioModule) {
          try {
            sttDebug('[STT_DEBUG] playQueue: setting allowsRecording=false for playback');
            await expoAudioModule.setAudioModeAsync({
              allowsRecording: false,
              interruptionMode: 'doNotMix',
              playsInSilentMode: true,
              shouldPlayInBackground: false,
              interruptionModeAndroid: 'doNotMix',
              shouldRouteThroughEarpiece: false
            });
            markAudioSessionPlaybackMode();
            sttDebug('[STT_DEBUG] playQueue: allowsRecording=false set successfully');
          } catch {
            // First attempt may fail if a recording session is still releasing.
            // Yield briefly and retry once so iOS routes audio to the loudspeaker.
            sttDebug('[STT_DEBUG] playQueue: first setAudioModeAsync failed, retrying after 200ms');
            await new Promise<void>((r) => setTimeout(r, 200));
            try {
              await expoAudioModule.setAudioModeAsync({
                allowsRecording: false,
                interruptionMode: 'doNotMix',
                playsInSilentMode: true,
                shouldPlayInBackground: false,
                interruptionModeAndroid: 'doNotMix',
                shouldRouteThroughEarpiece: false
              });
              markAudioSessionPlaybackMode();
              sttDebug('[STT_DEBUG] playQueue: allowsRecording=false set on retry');
            } catch {
              sttDebug('[STT_DEBUG] playQueue: allowsRecording=false FAILED even after retry');
            }
          }
        }
      }

      if (!isMountedRef.current || playbackTokenRef.current !== token) {
        return toPlaybackFailureResult('interrupted');
      }

      const playIndex = async (index: number): Promise<AudioPlaybackResult> => {
        if (!isMountedRef.current || playbackTokenRef.current !== token) {
          return toPlaybackFailureResult('interrupted');
        }

        releaseCurrentPlayers();

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
            // Fire the completion callback *before* stop() so consumers can
            // begin latency-sensitive work (e.g. STT restart) without waiting
            // for the React render cycle triggered by stop()'s state updates.
            onQueueCompleteRef.current?.();
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
          const handleError = () => {
            onChunkEnd();
          };

          clearWebListeners();
          webAudio.addEventListener('ended', handleEnded);
          webAudio.addEventListener('playing', handlePlaying);
          webAudio.addEventListener('error', handleError);
          detachWebListenersRef.current = () => {
            webAudio.removeEventListener('ended', handleEnded);
            webAudio.removeEventListener('playing', handlePlaying);
            webAudio.removeEventListener('error', handleError);
          };

          try {
            await webAudio.play();
            if (isMountedRef.current && playbackTokenRef.current === token) {
              setIsLoading(false);
              setIsPlaying(true);
            }
            markWebAutoplaySessionUnlocked();
            return PLAYBACK_STARTED_RESULT;
          } catch (error: unknown) {
            const reason = resolveAudioPlaybackFailureReason(error);
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

        const expoAudioModule = await loadExpoAudioModule();
        if (!expoAudioModule) {
          await stop();
          return toPlaybackFailureResult('playback_error');
        }

        try {
          const player = expoAudioModule.createAudioPlayer({ uri });
          soundRef.current = player;
          player.volume = 1;

          const subscription = player.addListener('playbackStatusUpdate', (status: NativeAudioStatus) => {
            if (!isMountedRef.current || playbackTokenRef.current !== token) {
              return;
            }

            if (!status.isLoaded) {
              return;
            }

            setIsLoading(false);
            setIsPlaying(status.playing);

            if (status.didJustFinish) {
              onChunkEnd();
            }
          });
          nativeSubscriptionRef.current = subscription;

          player.play();

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
          return toPlaybackFailureResult(reason);
        }
      };

      return playIndex(0);
    },
    [clearWebListeners, releaseAllAudio, releaseCurrentPlayers, stop]
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

    const player = soundRef.current;
    if (!player) {
      return;
    }

    try {
      if (player.playing) {
        player.pause();
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
    gracefulStop,
    onQueueCompleteRef
  };
}
