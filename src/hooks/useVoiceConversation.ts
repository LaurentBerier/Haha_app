import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { requestVoicePermission, startListening, stopListening } from '../services/voiceEngine';

const SILENCE_TIMEOUT_MS = 1500;
const MIN_BARGE_IN_WORDS = 2;

export interface UseVoiceConversationProps {
  enabled: boolean;
  disabled: boolean;
  isPlaying: boolean;
  onSend: (text: string) => void;
  onStopAudio: () => void;
  language: string;
}

export interface UseVoiceConversationReturn {
  isListening: boolean;
  transcript: string;
  error: string | null;
  interruptAndListen: () => void;
}

function countWords(input: string): number {
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function useVoiceConversation({
  enabled,
  disabled,
  isPlaying,
  onSend,
  onStopAudio,
  language
}: UseVoiceConversationProps): UseVoiceConversationReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const hasPermissionRef = useRef(false);
  const listeningRef = useRef(false);
  const transcriptRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enabledRef = useRef(enabled);
  const disabledRef = useRef(disabled);
  const isPlayingRef = useRef(isPlaying);
  const onSendRef = useRef(onSend);
  const onStopAudioRef = useRef(onStopAudio);
  const languageRef = useRef(language);

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

  const resetTranscript = useCallback(() => {
    transcriptRef.current = '';
    if (isMountedRef.current) {
      setTranscript('');
    }
  }, []);

  const stopListeningSession = useCallback(() => {
    clearSilenceTimer();
    if (listeningRef.current) {
      stopListening();
      listeningRef.current = false;
    }
    if (isMountedRef.current) {
      setIsListening(false);
    }
  }, [clearSilenceTimer]);

  const scheduleSilenceTimeout = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null;
      const toSend = transcriptRef.current.trim();
      if (!toSend || !enabledRef.current || disabledRef.current) {
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

  const startListeningSession = useCallback((force = false) => {
    if ((!enabledRef.current && !force) || disabledRef.current || !hasPermissionRef.current || listeningRef.current) {
      return;
    }

    setError(null);

    startListening(
      languageRef.current,
      (nextTranscript) => {
        const normalizedTranscript = nextTranscript.trim();
        if (!normalizedTranscript) {
          return;
        }

        if (isPlayingRef.current) {
          const wordCount = countWords(normalizedTranscript);
          if (wordCount < MIN_BARGE_IN_WORDS) {
            return;
          }
          onStopAudioRef.current();
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

        listeningRef.current = false;
        setIsListening(false);
        clearSilenceTimer();
        const message = listenError instanceof Error && listenError.message.trim() ? listenError.message : t('voiceError');
        if (typeof console !== 'undefined') {
          console.error('[useVoiceConversation] Listening error', { message, language: languageRef.current });
        }
        setError(message);
      }
    );

    listeningRef.current = true;
    setIsListening(true);
  }, [clearSilenceTimer, scheduleSilenceTimeout]);

  const ensureListening = useCallback(async (force = false) => {
    if ((!enabledRef.current && !force) || disabledRef.current) {
      if (!force) {
        stopListeningSession();
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
        setError(t('voicePermissionDenied'));
        if (!force) {
          stopListeningSession();
        }
        return;
      }
    }

    if (!listeningRef.current) {
      stopListeningSession();
    }
    startListeningSession(force);
  }, [startListeningSession, stopListeningSession]);

  useEffect(() => {
    void ensureListening();
  }, [ensureListening, enabled, disabled, language]);

  useEffect(() => {
    if (enabled && !disabled) {
      return;
    }

    resetTranscript();
  }, [disabled, enabled, resetTranscript]);

  const interruptAndListen = useCallback(() => {
    onStopAudioRef.current();
    if (disabledRef.current) {
      return;
    }

    if (hasPermissionRef.current) {
      if (!listeningRef.current) {
        startListeningSession(true);
      }
      return;
    }

    void ensureListening(true);
  }, [ensureListening, startListeningSession]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopListeningSession();
      resetTranscript();
    };
  }, [resetTranscript, stopListeningSession]);

  return {
    isListening,
    transcript,
    error,
    interruptAndListen
  };
}
