import { Platform } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { requestVoicePermission, startListening, stopListening } from '../services/voiceEngine';

const parsedSilenceTimeout = Number.parseInt(process.env.EXPO_PUBLIC_SILENCE_TIMEOUT_MS ?? '', 10);
const SILENCE_TIMEOUT_MS =
  Number.isFinite(parsedSilenceTimeout) && parsedSilenceTimeout >= 1200 ? parsedSilenceTimeout : 1800;
const WEB_NOISE_ERRORS = new Set(['no-speech', 'aborted']);
const IOS_TRANSIENT_ROUTE_ERROR_PATTERNS = [
  'audio route changed',
  'failed to restart the audio engine',
  'failed to restart audio engine',
  'route changed'
];
const IOS_ROUTE_RECOVERY_DELAY_MS = 320;
const IOS_ROUTE_RECOVERY_WINDOW_MS = 10_000;
const IOS_ROUTE_RECOVERY_MAX_ATTEMPTS = 4;
const LISTENING_WATCHDOG_BASE_DELAY_MS = 650;
const LISTENING_WATCHDOG_MAX_DELAY_MS = 3_200;
const LISTENING_WATCHDOG_MAX_ATTEMPTS = 4;
const HARD_PERMISSION_ERROR_PATTERNS = ['permission', 'not-allowed', 'service-not-allowed', 'denied', 'audio-capture'];

export interface UseVoiceConversationProps {
  enabled: boolean;
  disabled: boolean;
  isPlaying: boolean;
  onSend: (text: string) => void;
  onStopAudio: () => void;
  language: string;
  autoStartOnWeb?: boolean;
}

export interface UseVoiceConversationReturn {
  isListening: boolean;
  transcript: string;
  error: string | null;
  interruptAndListen: () => void;
}

export function useVoiceConversation({
  enabled,
  disabled,
  isPlaying,
  onSend,
  onStopAudio,
  language,
  autoStartOnWeb = true
}: UseVoiceConversationProps): UseVoiceConversationReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const hasPermissionRef = useRef(false);
  const listeningRef = useRef(false);
  const transcriptRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogAttemptCountRef = useRef(0);
  const hasHardPermissionErrorRef = useRef(false);
  const webGestureListenerRef = useRef<((event: Event) => void) | null>(null);
  const scheduleWatchdogRetryRef = useRef<(() => void) | null>(null);
  const iosRecoveryWindowStartedAtRef = useRef(0);
  const iosRecoveryAttemptCountRef = useRef(0);

  const enabledRef = useRef(enabled);
  const disabledRef = useRef(disabled);
  const isPlayingRef = useRef(isPlaying);
  const onSendRef = useRef(onSend);
  const onStopAudioRef = useRef(onStopAudio);
  const languageRef = useRef(language);

  const shouldAutoListen = Platform.OS !== 'web' || autoStartOnWeb;

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

  useEffect(() => {
    onStopAudioRef.current = onStopAudio;
  }, [onStopAudio]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, []);

  const clearWatchdogTimer = useCallback(() => {
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  }, []);

  const clearWebGestureListener = useCallback(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      webGestureListenerRef.current = null;
      return;
    }
    if (webGestureListenerRef.current) {
      document.removeEventListener('pointerdown', webGestureListenerRef.current, true);
      webGestureListenerRef.current = null;
    }
  }, []);

  const resetTranscript = useCallback(() => {
    transcriptRef.current = '';
    if (isMountedRef.current) {
      setTranscript('');
    }
  }, []);

  const stopListeningSession = useCallback(() => {
    clearSilenceTimer();
    clearRecoveryTimer();
    clearWatchdogTimer();
    if (listeningRef.current) {
      stopListening();
      listeningRef.current = false;
    }
    if (isMountedRef.current) {
      setIsListening(false);
    }
  }, [clearRecoveryTimer, clearSilenceTimer, clearWatchdogTimer]);

  const isTransientIosRouteError = useCallback((rawMessage: string): boolean => {
    if (Platform.OS !== 'ios') {
      return false;
    }

    const normalized = rawMessage.toLowerCase();
    return IOS_TRANSIENT_ROUTE_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
  }, []);

  const isHardPermissionError = useCallback((rawMessage: string): boolean => {
    const normalized = rawMessage.toLowerCase();
    return HARD_PERMISSION_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
  }, []);

  const canRecoverFromIosRouteError = useCallback((): boolean => {
    const now = Date.now();
    const windowStartedAt = iosRecoveryWindowStartedAtRef.current;
    if (!windowStartedAt || now - windowStartedAt > IOS_ROUTE_RECOVERY_WINDOW_MS) {
      iosRecoveryWindowStartedAtRef.current = now;
      iosRecoveryAttemptCountRef.current = 0;
    }

    if (iosRecoveryAttemptCountRef.current >= IOS_ROUTE_RECOVERY_MAX_ATTEMPTS) {
      return false;
    }

    iosRecoveryAttemptCountRef.current += 1;
    return true;
  }, []);

  const scheduleSilenceTimeout = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null;
      const toSend = transcriptRef.current.trim();
      if (!toSend || !enabledRef.current || disabledRef.current || isPlayingRef.current) {
        resetTranscript();
        return;
      }

      try {
        onSendRef.current(toSend);
      } catch (sendError) {
        if (isMountedRef.current) {
          const message =
            sendError instanceof Error && sendError.message.trim() ? sendError.message.trim() : t('voiceError');
          setError(message);
        }
      } finally {
        resetTranscript();
      }
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer, resetTranscript]);

  const startListeningSession = useCallback(
    (force = false) => {
      const allowWebForcedStart = force && Platform.OS === 'web';
      if (
        (!enabledRef.current && !force) ||
        disabledRef.current ||
        (isPlayingRef.current && !force) ||
        (!hasPermissionRef.current && !allowWebForcedStart) ||
        listeningRef.current
      ) {
        return;
      }

      if (allowWebForcedStart && !hasPermissionRef.current) {
        hasPermissionRef.current = true;
      }

      setError(null);

      const started = startListening(
        languageRef.current,
        (nextTranscript) => {
          if (isPlayingRef.current) {
            // Hard stop while Cathy speaks: ignore all transcript to avoid feedback loops.
            return;
          }

          const normalizedTranscript = nextTranscript.trim();
          if (!normalizedTranscript) {
            return;
          }

          transcriptRef.current = normalizedTranscript;
          if (isMountedRef.current) {
            setTranscript(normalizedTranscript);
          }
          scheduleSilenceTimeout();
        },
        (listenError) => {
          if (!isMountedRef.current) {
            return;
          }

          const message = listenError instanceof Error && listenError.message.trim() ? listenError.message.trim() : t('voiceError');
          if (isHardPermissionError(message)) {
            hasHardPermissionErrorRef.current = true;
            clearWatchdogTimer();
          }
          if (Platform.OS === 'web' && WEB_NOISE_ERRORS.has(message.toLowerCase())) {
            return;
          }

          if (isTransientIosRouteError(message) && canRecoverFromIosRouteError()) {
            clearSilenceTimer();
            clearRecoveryTimer();
            listeningRef.current = false;
            setIsListening(false);
            setError(null);

            try {
              stopListening();
            } catch {
              // Best effort reset before restarting speech recognition.
            }

            recoveryTimerRef.current = setTimeout(() => {
              recoveryTimerRef.current = null;
              if (!isMountedRef.current || !enabledRef.current || disabledRef.current || isPlayingRef.current) {
                return;
              }
              startListeningSession(true);
            }, IOS_ROUTE_RECOVERY_DELAY_MS);
            return;
          }

          listeningRef.current = false;
          setIsListening(false);
          clearSilenceTimer();
          clearRecoveryTimer();
          setError(message);
        }
      );

      listeningRef.current = started;
      setIsListening(started);
      if (started) {
        hasHardPermissionErrorRef.current = false;
        watchdogAttemptCountRef.current = 0;
        clearWatchdogTimer();
      }
    },
    [
      canRecoverFromIosRouteError,
      clearRecoveryTimer,
      clearSilenceTimer,
      clearWatchdogTimer,
      isHardPermissionError,
      isTransientIosRouteError,
      scheduleSilenceTimeout
    ]
  );

  const ensureListening = useCallback(
    async (force = false) => {
      if ((!enabledRef.current && !force) || disabledRef.current || (isPlayingRef.current && !force)) {
        if (!force) {
          stopListeningSession();
        }
        return;
      }

      if (Platform.OS === 'web') {
        hasPermissionRef.current = true;
        if (!listeningRef.current) {
          startListeningSession(force);
        }
        return;
      }

      if (!hasPermissionRef.current) {
        const granted = await requestVoicePermission();
        if (!isMountedRef.current) {
          return;
        }

        hasPermissionRef.current = granted;
        if (!granted) {
          hasHardPermissionErrorRef.current = true;
          clearWatchdogTimer();
          setError(t('voicePermissionDenied'));
          if (!force) {
            stopListeningSession();
          }
          return;
        }

        hasHardPermissionErrorRef.current = false;
        watchdogAttemptCountRef.current = 0;
      }

      if (!listeningRef.current) {
        startListeningSession(force);
      }
    },
    [clearWatchdogTimer, startListeningSession, stopListeningSession]
  );

  useEffect(() => {
    scheduleWatchdogRetryRef.current = () => {
      clearWatchdogTimer();
      if (
        !isMountedRef.current ||
        !enabledRef.current ||
        disabledRef.current ||
        isPlayingRef.current ||
        listeningRef.current ||
        hasHardPermissionErrorRef.current
      ) {
        return;
      }

      if (watchdogAttemptCountRef.current >= LISTENING_WATCHDOG_MAX_ATTEMPTS) {
        return;
      }

      const nextAttempt = watchdogAttemptCountRef.current + 1;
      const delay = Math.min(
        LISTENING_WATCHDOG_MAX_DELAY_MS,
        LISTENING_WATCHDOG_BASE_DELAY_MS * 2 ** (nextAttempt - 1)
      );

      watchdogTimerRef.current = setTimeout(() => {
        watchdogTimerRef.current = null;
        if (
          !isMountedRef.current ||
          !enabledRef.current ||
          disabledRef.current ||
          isPlayingRef.current ||
          listeningRef.current ||
          hasHardPermissionErrorRef.current
        ) {
          return;
        }

        watchdogAttemptCountRef.current = nextAttempt;
        void ensureListening(true);

        if (!listeningRef.current && !hasHardPermissionErrorRef.current) {
          scheduleWatchdogRetryRef.current?.();
        }
      }, delay);
    };

    return () => {
      scheduleWatchdogRetryRef.current = null;
    };
  }, [clearWatchdogTimer, ensureListening]);

  useEffect(() => {
    if (!shouldAutoListen || !enabled || disabled || isPlaying) {
      watchdogAttemptCountRef.current = 0;
      clearWatchdogTimer();
      return;
    }

    if (isListening) {
      watchdogAttemptCountRef.current = 0;
      clearWatchdogTimer();
      return;
    }

    if (hasHardPermissionErrorRef.current) {
      clearWatchdogTimer();
      return;
    }

    scheduleWatchdogRetryRef.current?.();
  }, [clearWatchdogTimer, disabled, enabled, isListening, isPlaying, shouldAutoListen]);

  useEffect(() => {
    if (!enabled || disabled) {
      stopListeningSession();
      resetTranscript();
      hasHardPermissionErrorRef.current = false;
      watchdogAttemptCountRef.current = 0;
      return;
    }

    if (shouldAutoListen) {
      void ensureListening();
    }
  }, [disabled, enabled, ensureListening, resetTranscript, shouldAutoListen, stopListeningSession, language]);

  useEffect(() => {
    if (!enabled || disabled) {
      return;
    }

    // Temporary echo isolation: pause STT while Cathy TTS is playing.
    if (isPlaying) {
      stopListeningSession();
      resetTranscript();
      watchdogAttemptCountRef.current = 0;
      return;
    }

    if (shouldAutoListen) {
      void ensureListening();
    }
  }, [disabled, enabled, ensureListening, isPlaying, resetTranscript, shouldAutoListen, stopListeningSession]);

  useEffect(() => {
    if (
      Platform.OS !== 'web' ||
      typeof document === 'undefined' ||
      !autoStartOnWeb ||
      !enabled ||
      disabled ||
      listeningRef.current
    ) {
      return;
    }

    const startFromFirstGesture = () => {
      if (!enabledRef.current || disabledRef.current || listeningRef.current) {
        return;
      }

      startListeningSession(true);

      if (listeningRef.current) {
        clearWebGestureListener();
      }
    };
    clearWebGestureListener();
    webGestureListenerRef.current = startFromFirstGesture;
    document.addEventListener('pointerdown', startFromFirstGesture, true);
    return () => {
      clearWebGestureListener();
    };
  }, [autoStartOnWeb, clearWebGestureListener, disabled, enabled, startListeningSession]);

  const interruptAndListen = useCallback(() => {
    onStopAudioRef.current();
    if (disabledRef.current) {
      return;
    }

    if (listeningRef.current) {
      stopListeningSession();
      return;
    }

    if (Platform.OS === 'web') {
      startListeningSession(true);
      return;
    }

    if (hasPermissionRef.current) {
      startListeningSession(true);
      return;
    }

    void ensureListening(true);
  }, [ensureListening, startListeningSession, stopListeningSession]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopListeningSession();
      clearRecoveryTimer();
      clearWatchdogTimer();
      clearWebGestureListener();
      resetTranscript();
    };
  }, [clearRecoveryTimer, clearWatchdogTimer, clearWebGestureListener, resetTranscript, stopListeningSession]);

  return {
    isListening,
    transcript,
    error,
    interruptAndListen
  };
}
