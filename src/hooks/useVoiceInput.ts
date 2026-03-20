import { useCallback, useEffect, useRef, useState } from 'react';
import { getLanguage, t } from '../i18n';
import { useStore } from '../store/useStore';
import { requestVoicePermission, startVoiceListeningSession, type VoiceListeningSession } from '../services/voiceEngine';

const ERROR_RESET_MS = 2000;
const TRANSCRIBING_DELAY_MS = 250;

export function useVoiceInput() {
  const voiceStatus = useStore((state) => state.voiceStatus);
  const setVoiceStatus = useStore((state) => state.setVoiceStatus);
  const [transcript, setTranscript] = useState('');
  const [hasPermission, setHasPermission] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const transcriptRef = useRef('');
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcribingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<VoiceListeningSession | null>(null);

  const resetErrorState = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const resetTranscribingTimer = useCallback(() => {
    if (transcribingTimerRef.current) {
      clearTimeout(transcribingTimerRef.current);
      transcribingTimerRef.current = null;
    }
  }, []);

  const enterErrorState = useCallback(
    (message: string) => {
      resetErrorState();
      setVoiceError(message);
      setVoiceStatus('error');
      resetTimerRef.current = setTimeout(() => {
        setVoiceStatus('idle');
      }, ERROR_RESET_MS);
    },
    [resetErrorState, setVoiceStatus]
  );

  useEffect(() => {
    return () => {
      resetErrorState();
      resetTranscribingTimer();
      sessionRef.current?.stop();
      sessionRef.current = null;
      setVoiceStatus('idle');
    };
  }, [resetErrorState, resetTranscribingTimer, setVoiceStatus]);

  const startRecording = useCallback(async () => {
    if (voiceStatus === 'recording') {
      return;
    }

    let granted = hasPermission;
    if (!granted) {
      granted = await requestVoicePermission();
      setHasPermission(granted);
    }

    if (!granted) {
      enterErrorState(t('voicePermissionDenied'));
      return;
    }

    resetErrorState();
    setVoiceError(null);
    transcriptRef.current = '';
    setTranscript('');
    setVoiceStatus('recording');

    sessionRef.current?.stop();
    sessionRef.current = startVoiceListeningSession({
      locale: getLanguage(),
      onResult: (event) => {
        transcriptRef.current = event.transcript;
        setTranscript(event.transcript);
      },
      onEnd: (event) => {
        if (sessionRef.current?.id !== event.sessionId) {
          return;
        }
        sessionRef.current = null;
        if (event.reason === 'stopped') {
          setVoiceStatus('idle');
          return;
        }
        enterErrorState(event.reason === 'permission' ? t('voicePermissionDenied') : t('voiceError'));
      }
    });
  }, [enterErrorState, hasPermission, resetErrorState, setVoiceStatus, voiceStatus]);

  const stopRecording = useCallback(async (): Promise<string> => {
    if (voiceStatus !== 'recording') {
      return transcriptRef.current;
    }

    setVoiceStatus('transcribing');
    sessionRef.current?.stop();
    sessionRef.current = null;

    resetTranscribingTimer();
    await new Promise<void>((resolve) => {
      transcribingTimerRef.current = setTimeout(() => {
        transcribingTimerRef.current = null;
        resolve();
      }, TRANSCRIBING_DELAY_MS);
    });
    setVoiceStatus('idle');
    return transcriptRef.current;
  }, [resetTranscribingTimer, setVoiceStatus, voiceStatus]);

  return {
    voiceStatus,
    transcript,
    voiceError,
    hasPermission,
    startRecording,
    stopRecording
  };
}
