import { Audio, type AVPlaybackStatus } from 'expo-av';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

interface WebAudioLike {
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener: (event: string, handler: () => void) => void;
  pause: () => void;
  play: () => Promise<void>;
  src: string;
}

export interface AudioPlayerController {
  isPlaying: boolean;
  isLoading: boolean;
  currentUri: string | null;
  currentIndex: number;
  totalChunks: number;
  play: (uri: string) => Promise<void>;
  playQueue: (uris: string[]) => Promise<void>;
  appendToQueue: (uri: string) => void;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
}

function isLoadedStatus(status: AVPlaybackStatus): status is AVPlaybackStatus & { isLoaded: true } {
  return status.isLoaded;
}

export function useAudioPlayer(): AudioPlayerController {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentUri, setCurrentUri] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);

  const soundRef = useRef<Audio.Sound | null>(null);
  const webAudioRef = useRef<WebAudioLike | null>(null);
  const detachWebListenersRef = useRef<null | (() => void)>(null);
  const queueRef = useRef<string[]>([]);
  const queueIndexRef = useRef(0);
  const playbackTokenRef = useRef(0);
  const isMountedRef = useRef(true);

  const clearWebListeners = useCallback(() => {
    detachWebListenersRef.current?.();
    detachWebListenersRef.current = null;
  }, []);

  const releaseWebAudio = useCallback(() => {
    clearWebListeners();
    if (webAudioRef.current) {
      webAudioRef.current.pause();
      webAudioRef.current.src = '';
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
    setCurrentIndex(0);
    setTotalChunks(0);
  }, []);

  const stop = useCallback(async () => {
    playbackTokenRef.current += 1;
    queueRef.current = [];
    queueIndexRef.current = 0;
    await releaseAllAudio();
    resetState();
  }, [releaseAllAudio, resetState]);

  const playQueue = useCallback(
    async (uris: string[]) => {
      const nextQueue = uris.map((uri) => uri.trim()).filter(Boolean);
      if (nextQueue.length === 0) {
        return;
      }

      const token = playbackTokenRef.current + 1;
      playbackTokenRef.current = token;
      queueRef.current = nextQueue;
      queueIndexRef.current = 0;

      await releaseAllAudio();

      const playIndex = async (index: number): Promise<void> => {
        if (!isMountedRef.current || playbackTokenRef.current !== token) {
          return;
        }

        await releaseAllAudio();

        if (!isMountedRef.current || playbackTokenRef.current !== token) {
          return;
        }

        const queue = queueRef.current;
        const uri = queue[index];
        if (!uri) {
          await stop();
          return;
        }

        queueIndexRef.current = index;
        setCurrentUri(uri);
        setCurrentIndex(index);
        setTotalChunks(queue.length);
        setIsLoading(true);
        setIsPlaying(false);

        const onChunkEnd = () => {
          if (!isMountedRef.current || playbackTokenRef.current !== token) {
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
          const WebAudioCtor = (globalThis as { Audio?: new (src?: string) => WebAudioLike }).Audio;
          if (!WebAudioCtor) {
            await stop();
            return;
          }

          const webAudio = new WebAudioCtor(uri);
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
            setIsPlaying(false);
          };
          const handleError = () => {
            onChunkEnd();
          };

          webAudio.addEventListener('ended', handleEnded);
          webAudio.addEventListener('playing', handlePlaying);
          webAudio.addEventListener('pause', handlePause);
          webAudio.addEventListener('error', handleError);
          clearWebListeners();
          detachWebListenersRef.current = () => {
            webAudio.removeEventListener('ended', handleEnded);
            webAudio.removeEventListener('playing', handlePlaying);
            webAudio.removeEventListener('pause', handlePause);
            webAudio.removeEventListener('error', handleError);
          };

          try {
            await webAudio.play();
            if (isMountedRef.current && playbackTokenRef.current === token) {
              setIsLoading(false);
              setIsPlaying(true);
            }
          } catch {
            onChunkEnd();
          }
          return;
        }

        try {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            interruptionModeIOS: 1,
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
            shouldDuckAndroid: true,
            interruptionModeAndroid: 1,
            playThroughEarpieceAndroid: false
          });
        } catch {
          // best effort
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
          await sound.loadAsync({ uri }, { shouldPlay: true }, true);
          if (isMountedRef.current && playbackTokenRef.current === token) {
            setIsLoading(false);
            setIsPlaying(true);
          }
        } catch {
          onChunkEnd();
        }
      };

      await playIndex(0);
    },
    [clearWebListeners, releaseAllAudio, stop]
  );

  const play = useCallback(async (uri: string) => {
    await playQueue([uri]);
  }, [playQueue]);

  const appendToQueue = useCallback(
    (uri: string) => {
      const trimmed = uri.trim();
      if (!trimmed) {
        return;
      }

      if (queueRef.current.length > 0) {
        queueRef.current.push(trimmed);
        if (isMountedRef.current) {
          setTotalChunks(queueRef.current.length);
        }
        return;
      }

      void playQueue([trimmed]);
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
    currentIndex,
    totalChunks,
    play,
    playQueue,
    appendToQueue,
    pause,
    stop
  };
}
