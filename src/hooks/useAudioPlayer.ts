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

// ---------------------------------------------------------------------------
// iOS Safari: AudioContext-based TTS playback
//
// On iOS Safari, an <audio> element holds the audio route even after
// pause()+src=''+load(). This prevents STT (webkitSpeechRecognition) from
// detecting speech — onaudiostart fires but onspeechstart never does.
// Destroying the element fixes STT but kills autoplay (iOS binds unlock to
// the specific element instance).
//
// AudioContext avoids both problems: once gesture-unlocked it can play audio
// indefinitely without per-element gestures, and suspending it fully releases
// the audio route for STT.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let iosAudioCtx: any = null;

function getOrCreateIosAudioCtx(): AudioContext | null {
  if (!IS_IOS_MOBILE_WEB) return null;
  try {
    if (iosAudioCtx && iosAudioCtx.state !== 'closed') {
      return iosAudioCtx;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ACtor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!ACtor) return null;
    iosAudioCtx = new ACtor();
    sttDebug(`[STT_DEBUG] iOS AudioContext created (state=${iosAudioCtx.state})`);
    return iosAudioCtx;
  } catch {
    return null;
  }
}

// Prime the AudioContext on the first user gesture. iOS Safari requires
// AudioContext.resume() during a user interaction to unlock audio output.
// The context is left in 'running' state so greeting TTS can autoplay
// immediately. STT startup suspends it via ensureIosAudioContextSuspended().
if (IS_IOS_MOBILE_WEB && typeof document !== 'undefined') {
  const primeCtx = () => {
    const ctx = getOrCreateIosAudioCtx();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
      sttDebug('[STT_DEBUG] iOS AudioContext resumed during user gesture');
    }
    ['touchstart', 'pointerdown', 'mousedown', 'keydown'].forEach(e => {
      document.removeEventListener(e, primeCtx, true);
    });
  };
  ['touchstart', 'pointerdown', 'mousedown', 'keydown'].forEach(e => {
    document.addEventListener(e, primeCtx, { capture: true });
  });
}

/** Ensure the iOS AudioContext is suspended so STT can claim the audio route.
 *  No-op on non-iOS or if the context doesn't exist / is already suspended. */
export function ensureIosAudioContextSuspended(): void {
  if (!iosAudioCtx) {
    sttDebug('[STT_DEBUG] ensureIosAudioContextSuspended: no AudioContext (null)');
    return;
  }
  if (iosAudioCtx.state === 'running') {
    iosAudioCtx.suspend().catch(() => {});
    sttDebug('[STT_DEBUG] ensureIosAudioContextSuspended: suspended running AudioContext');
  } else {
    sttDebug(`[STT_DEBUG] ensureIosAudioContextSuspended: already ${iosAudioCtx.state}`);
  }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iosSourceRef = useRef<any>(null);

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
    // iOS Safari: clean up active AudioContext source and suspend the context
    // to release the audio route so STT can claim the mic.
    if (IS_IOS_MOBILE_WEB) {
      const iosSource = iosSourceRef.current;
      if (iosSource) {
        iosSourceRef.current = null;
        iosSource.onended = null;
        try { iosSource.stop(); } catch { /* already ended */ }
      }
      if (forMicReclaim && iosAudioCtx && iosAudioCtx.state === 'running') {
        iosAudioCtx.suspend().catch(() => {});
        sttDebug('[STT_DEBUG] releaseWebAudio: suspended iOS AudioContext for mic reclaim');
      }
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
    // Clean up iOS AudioContext source between queue chunks
    if (IS_IOS_MOBILE_WEB) {
      const iosSource = iosSourceRef.current;
      if (iosSource) {
        iosSourceRef.current = null;
        iosSource.onended = null;
        try { iosSource.stop(); } catch { /* already ended */ }
      }
    }
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
          // iOS Safari: use AudioContext to avoid <audio> element holding audio route
          sttDebug(`[STT_DEBUG] playIndex: isIOS=${IS_IOS_MOBILE_WEB}, iosAudioCtx=${iosAudioCtx ? iosAudioCtx.state : 'null'}, uri=${uri.substring(0, 50)}`);
          if (IS_IOS_MOBILE_WEB && iosAudioCtx && iosAudioCtx.state !== 'closed') {
            try {
              const audioCtx = iosAudioCtx;

              // Resume if suspended (from previous STT mic reclaim)
              if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
                sttDebug('[STT_DEBUG] iOS AudioContext: resumed for playback');
              }

              if (!isMountedRef.current || playbackTokenRef.current !== token) {
                return toPlaybackFailureResult('interrupted');
              }

              // Fetch and decode audio data
              const response = await fetch(uri);
              if (!isMountedRef.current || playbackTokenRef.current !== token) {
                return toPlaybackFailureResult('interrupted');
              }
              const arrayBuffer = await response.arrayBuffer();
              if (!isMountedRef.current || playbackTokenRef.current !== token) {
                return toPlaybackFailureResult('interrupted');
              }
              const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
              if (!isMountedRef.current || playbackTokenRef.current !== token) {
                return toPlaybackFailureResult('interrupted');
              }

              // Create and start source
              const source = audioCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(audioCtx.destination);

              // Clean up previous source (safety — should already be ended)
              const prevSource = iosSourceRef.current;
              if (prevSource) {
                prevSource.onended = null;
                try { prevSource.stop(); } catch { /* already ended */ }
              }
              iosSourceRef.current = source;

              source.onended = () => {
                if (iosSourceRef.current === source) {
                  iosSourceRef.current = null;
                }
                onChunkEnd();
              };

              source.start();

              if (isMountedRef.current && playbackTokenRef.current === token) {
                setIsLoading(false);
                setIsPlaying(true);
              }
              markWebAutoplaySessionUnlocked();
              sttDebug('[STT_DEBUG] iOS AudioContext: chunk playback started');
              return PLAYBACK_STARTED_RESULT;
            } catch (iosErr: unknown) {
              sttDebug(`[STT_DEBUG] iOS AudioContext playback failed: ${iosErr instanceof Error ? iosErr.message : String(iosErr)}, falling back to <audio>`);
              // Fall through to <audio> element path
            }
          }

          // Standard web / iOS AudioContext fallback: use persistent <audio> element
          sttDebug(`[STT_DEBUG] playIndex: using <audio> element fallback (isIOS=${IS_IOS_MOBILE_WEB})`);
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
            sttDebug('[STT_DEBUG] <audio> element: playback started');
            return PLAYBACK_STARTED_RESULT;
          } catch (error: unknown) {
            const reason = resolveAudioPlaybackFailureReason(error);
            sttDebug(`[STT_DEBUG] <audio> element: play() failed, reason=${reason}, error=${error instanceof Error ? error.message : String(error)}`);
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
      // iOS AudioContext: suspend to pause all audio output
      if (IS_IOS_MOBILE_WEB && iosAudioCtx && iosAudioCtx.state === 'running') {
        iosAudioCtx.suspend().catch(() => {});
      }
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
