import { Platform } from 'react-native';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { t } from '../i18n';
import {
  requestVoicePermission,
  startVoiceListeningSession,
  type VoiceListeningEndEvent,
  type VoiceListeningSession,
  type VoiceSessionEndReason
} from '../services/voiceEngine';

const parsedSilenceTimeout = Number.parseInt(process.env.EXPO_PUBLIC_SILENCE_TIMEOUT_MS ?? '', 10);
const SILENCE_TIMEOUT_MS =
  Number.isFinite(parsedSilenceTimeout) && parsedSilenceTimeout >= 1200 ? parsedSilenceTimeout : 1800;
const RECOVERY_DELAYS_MS = [250, 800, 2000] as const;

export type VoiceConversationStatus =
  | 'off'
  | 'starting'
  | 'listening'
  | 'assistant_busy'
  | 'paused_manual'
  | 'recovering'
  | 'paused_recovery'
  | 'unsupported'
  | 'error';

export interface UseVoiceConversationProps {
  enabled: boolean;
  disabled: boolean;
  isPlaying: boolean;
  hasTypedDraft?: boolean;
  onSend: (text: string) => void;
  onStopAudio: () => void;
  language: string;
  autoStartOnWeb?: boolean;
}

export interface UseVoiceConversationReturn {
  isListening: boolean;
  isManuallyPaused: boolean;
  transcript: string;
  error: string | null;
  status: VoiceConversationStatus;
  hint: string | null;
  interruptAndListen: () => void;
  pauseListening: () => void;
  resumeListening: () => void;
  armListeningActivation: () => void;
}

export interface AutoListenState {
  shouldAutoListen: boolean;
  hasUserActivation: boolean;
  enabled: boolean;
  disabled: boolean;
  isPlaying: boolean;
  hasTypedDraft: boolean;
  status: VoiceConversationStatus;
}

interface VoiceConversationState {
  status: VoiceConversationStatus;
  transcript: string;
  error: string | null;
  recoveryAttempt: number;
}

type VoiceConversationAction =
  | { type: 'set_off' }
  | { type: 'starting' }
  | { type: 'listening' }
  | { type: 'assistant_busy' }
  | { type: 'set_transcript'; transcript: string }
  | { type: 'clear_transcript' }
  | { type: 'pause_manual' }
  | { type: 'recovery_scheduled'; attempt: number }
  | { type: 'pause_recovery' }
  | { type: 'unsupported' }
  | { type: 'error'; message: string };

const INITIAL_STATE: VoiceConversationState = {
  status: 'off',
  transcript: '',
  error: null,
  recoveryAttempt: 0
};

function isLockedMicStatus(status: VoiceConversationStatus): boolean {
  return status === 'paused_manual' || status === 'paused_recovery' || status === 'unsupported' || status === 'error';
}

function isRecoverableEndReason(reason: VoiceSessionEndReason): boolean {
  return (
    reason === 'no_speech' ||
    reason === 'aborted' ||
    reason === 'ended_unexpectedly' ||
    reason === 'transient'
  );
}

export function shouldConsumeVoiceRecoveryBudget(reason: VoiceSessionEndReason): boolean {
  return reason === 'aborted' || reason === 'transient';
}

function voiceConversationReducer(
  state: VoiceConversationState,
  action: VoiceConversationAction
): VoiceConversationState {
  switch (action.type) {
    case 'set_off':
      return {
        status: 'off',
        transcript: '',
        error: null,
        recoveryAttempt: 0
      };
    case 'starting':
      return {
        ...state,
        status: 'starting',
        transcript: '',
        error: null
      };
    case 'listening':
      return {
        ...state,
        status: 'listening',
        error: null
      };
    case 'assistant_busy':
      return {
        ...state,
        status: 'assistant_busy',
        transcript: '',
        error: null
      };
    case 'set_transcript':
      return {
        ...state,
        status: 'listening',
        transcript: action.transcript,
        error: null,
        recoveryAttempt: 0
      };
    case 'clear_transcript':
      if (!state.transcript) {
        return state;
      }
      return {
        ...state,
        transcript: ''
      };
    case 'pause_manual':
      return {
        status: 'paused_manual',
        transcript: '',
        error: null,
        recoveryAttempt: 0
      };
    case 'recovery_scheduled':
      return {
        ...state,
        status: 'recovering',
        transcript: '',
        error: null,
        recoveryAttempt: action.attempt
      };
    case 'pause_recovery':
      return {
        status: 'paused_recovery',
        transcript: '',
        error: null,
        recoveryAttempt: RECOVERY_DELAYS_MS.length
      };
    case 'unsupported':
      return {
        status: 'unsupported',
        transcript: '',
        error: null,
        recoveryAttempt: 0
      };
    case 'error':
      return {
        status: 'error',
        transcript: '',
        error: action.message,
        recoveryAttempt: 0
      };
    default:
      return state;
  }
}

function logVoiceDebug(event: string, payload?: Record<string, unknown>): void {
  if (!__DEV__) {
    return;
  }

  if (payload) {
    console.log('[useVoiceConversation]', event, payload);
    return;
  }

  console.log('[useVoiceConversation]', event);
}

export function getVoiceRecoveryDelayMs(attempt: number): number | null {
  return RECOVERY_DELAYS_MS[attempt - 1] ?? null;
}

export function getVoiceRecoveryPlan(
  reason: VoiceSessionEndReason,
  currentAttempt: number
): { attempt: number; delayMs: number | null; consumesBudget: boolean } {
  const consumesBudget = shouldConsumeVoiceRecoveryBudget(reason);
  const attempt = consumesBudget ? currentAttempt + 1 : currentAttempt;
  return {
    attempt,
    delayMs: consumesBudget ? getVoiceRecoveryDelayMs(attempt) : RECOVERY_DELAYS_MS[0],
    consumesBudget
  };
}

export function getVoiceConversationHint(status: VoiceConversationStatus): string | null {
  if (status === 'paused_manual') {
    return t('micPausedHint');
  }
  if (status === 'paused_recovery') {
    return t('micRecoveryPausedHint');
  }
  if (status === 'unsupported') {
    return t('micUnsupportedHint');
  }
  return null;
}

export function shouldAttemptAutoListen(state: AutoListenState): boolean {
  return (
    state.shouldAutoListen &&
    state.hasUserActivation &&
    state.enabled &&
    !state.disabled &&
    !state.hasTypedDraft &&
    !state.isPlaying &&
    !isLockedMicStatus(state.status)
  );
}

export function useVoiceConversation({
  enabled,
  disabled,
  isPlaying,
  hasTypedDraft = false,
  onSend,
  onStopAudio,
  language,
  autoStartOnWeb = true
}: UseVoiceConversationProps): UseVoiceConversationReturn {
  const [state, dispatch] = useReducer(voiceConversationReducer, INITIAL_STATE);
  const stateRef = useRef(state);
  const isMountedRef = useRef(true);
  const hasPermissionRef = useRef(false);
  const activeSessionRef = useRef<VoiceListeningSession | null>(null);
  const startInFlightRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUserActivatedListeningRef = useRef(Platform.OS !== 'web');
  const startListeningFlowRef = useRef<((origin: 'auto' | 'recovery' | 'resume' | 'interrupt') => Promise<void>) | null>(null);
  const enabledRef = useRef(enabled);
  const disabledRef = useRef(disabled);
  const isPlayingRef = useRef(isPlaying);
  const hasTypedDraftRef = useRef(hasTypedDraft);
  const onSendRef = useRef(onSend);
  const onStopAudioRef = useRef(onStopAudio);
  const languageRef = useRef(language);
  const shouldAutoListen = Platform.OS !== 'web' || autoStartOnWeb;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
    hasTypedDraftRef.current = hasTypedDraft;
  }, [hasTypedDraft]);

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
    if (!silenceTimerRef.current) {
      return;
    }

    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
  }, []);

  const clearRecoveryTimer = useCallback(() => {
    if (!recoveryTimerRef.current) {
      return;
    }

    clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = null;
  }, []);

  const stopActiveSession = useCallback(() => {
    const activeSession = activeSessionRef.current;
    activeSessionRef.current = null;
    activeSession?.stop();
  }, []);

  const clearTranscript = useCallback(() => {
    dispatch({ type: 'clear_transcript' });
  }, []);

  const scheduleSilenceTimeout = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null;
      const latestState = stateRef.current;
      const textToSend = latestState.transcript.trim();

      if (!textToSend) {
        clearTranscript();
        return;
      }

      if (
        !enabledRef.current ||
        disabledRef.current ||
        hasTypedDraftRef.current ||
        isPlayingRef.current ||
        isLockedMicStatus(latestState.status)
      ) {
        clearTranscript();
        return;
      }

      try {
        onSendRef.current(textToSend);
        clearTranscript();
      } catch (sendError) {
        const message =
          sendError instanceof Error && sendError.message.trim() ? sendError.message.trim() : t('voiceError');
        logVoiceDebug('send_failed', { message });
        stopActiveSession();
        dispatch({ type: 'error', message });
      }
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer, clearTranscript, stopActiveSession]);

  const handleSessionEnd = useCallback(
    (event: VoiceListeningEndEvent) => {
      if (activeSessionRef.current?.id !== event.sessionId) {
        return;
      }

      activeSessionRef.current = null;
      clearSilenceTimer();
      logVoiceDebug('session_end', {
        sessionId: event.sessionId,
        reason: event.reason,
        message: event.message,
        recoveryAttempt: stateRef.current.recoveryAttempt
      });

      if (event.reason === 'permission') {
        hasPermissionRef.current = false;
        dispatch({ type: 'error', message: t('voicePermissionDenied') });
        return;
      }

      if (event.reason === 'unsupported') {
        dispatch({ type: 'unsupported' });
        return;
      }

      if (
        !enabledRef.current ||
        disabledRef.current ||
        isLockedMicStatus(stateRef.current.status) ||
        isPlayingRef.current
      ) {
        return;
      }

      if (isRecoverableEndReason(event.reason)) {
        const recoveryPlan = getVoiceRecoveryPlan(event.reason, stateRef.current.recoveryAttempt);

        if (recoveryPlan.consumesBudget && recoveryPlan.delayMs === null) {
          logVoiceDebug('recovery_exhausted', {
            sessionId: event.sessionId,
            reason: event.reason,
            recoveryAttempt: stateRef.current.recoveryAttempt
          });
          dispatch({ type: 'pause_recovery' });
          return;
        }

        dispatch({ type: 'recovery_scheduled', attempt: recoveryPlan.attempt });
        logVoiceDebug('recovery_scheduled', {
          sessionId: event.sessionId,
          reason: event.reason,
          attempt: recoveryPlan.attempt,
          delayMs: recoveryPlan.delayMs,
          consumesBudget: recoveryPlan.consumesBudget
        });
        clearRecoveryTimer();
        recoveryTimerRef.current = setTimeout(() => {
          recoveryTimerRef.current = null;
          if (
            !isMountedRef.current ||
            !shouldAttemptAutoListen({
              shouldAutoListen,
              hasUserActivation: hasUserActivatedListeningRef.current,
              enabled: enabledRef.current,
              disabled: disabledRef.current,
              isPlaying: isPlayingRef.current,
              hasTypedDraft: hasTypedDraftRef.current,
              status: stateRef.current.status
            })
          ) {
            return;
          }

          dispatch({ type: 'starting' });
          void startListeningFlowRef.current?.('recovery');
        }, recoveryPlan.delayMs ?? RECOVERY_DELAYS_MS[0]);
        return;
      }

      dispatch({ type: 'error', message: event.message ?? t('voiceError') });
    },
    [clearRecoveryTimer, clearSilenceTimer, shouldAutoListen]
  );

  const handleSessionResult = useCallback(
    (sessionId: number, transcript: string) => {
      if (activeSessionRef.current?.id !== sessionId) {
        return;
      }

      if (isPlayingRef.current) {
        return;
      }

      dispatch({ type: 'set_transcript', transcript });
      scheduleSilenceTimeout();
    },
    [scheduleSilenceTimeout]
  );

  const startListeningFlow = useCallback(
    async (origin: 'auto' | 'recovery' | 'resume' | 'interrupt') => {
      if (!isMountedRef.current) {
        return;
      }

      if (startInFlightRef.current) {
        return;
      }

      const latestStatus = stateRef.current.status;
      const canStart =
        origin === 'auto' || origin === 'recovery'
          ? shouldAttemptAutoListen({
              shouldAutoListen,
              hasUserActivation: hasUserActivatedListeningRef.current,
              enabled: enabledRef.current,
              disabled: disabledRef.current,
              isPlaying: isPlayingRef.current,
              hasTypedDraft: hasTypedDraftRef.current,
              status: latestStatus
            })
          : enabledRef.current &&
            !disabledRef.current &&
            !hasTypedDraftRef.current &&
            !isPlayingRef.current;

      if (!canStart) {
        return;
      }

      startInFlightRef.current = true;
      try {
        clearRecoveryTimer();
        clearSilenceTimer();
        stopActiveSession();
        clearTranscript();

        if (origin !== 'recovery') {
          dispatch({ type: 'starting' });
        }

        if (Platform.OS !== 'web' && !hasPermissionRef.current) {
          const granted = await requestVoicePermission();
          if (!isMountedRef.current) {
            return;
          }

          hasPermissionRef.current = granted;
          if (!granted) {
            dispatch({ type: 'error', message: t('voicePermissionDenied') });
            return;
          }
        }

        const stillAllowed =
          origin === 'auto' || origin === 'recovery'
          ? shouldAttemptAutoListen({
              shouldAutoListen,
              hasUserActivation: hasUserActivatedListeningRef.current,
              enabled: enabledRef.current,
              disabled: disabledRef.current,
              isPlaying: isPlayingRef.current,
              hasTypedDraft: hasTypedDraftRef.current,
              status: stateRef.current.status
            })
            : enabledRef.current &&
              !disabledRef.current &&
              !hasTypedDraftRef.current &&
              !isPlayingRef.current;

        if (!stillAllowed) {
          dispatch({ type: 'set_off' });
          return;
        }

        logVoiceDebug('session_start', {
          origin,
          statusBeforeStart: latestStatus,
          recoveryAttempt: stateRef.current.recoveryAttempt
        });

        const session = startVoiceListeningSession({
          locale: languageRef.current,
          onResult: (event) => {
            handleSessionResult(event.sessionId, event.transcript);
          },
          onEnd: handleSessionEnd
        });

        if (!isMountedRef.current) {
          session.stop();
          return;
        }

        activeSessionRef.current = session;
        dispatch({ type: 'listening' });
      } finally {
        startInFlightRef.current = false;
      }
    },
    [
      clearRecoveryTimer,
      clearSilenceTimer,
      clearTranscript,
      handleSessionEnd,
      handleSessionResult,
      shouldAutoListen,
      stopActiveSession
    ]
  );

  useEffect(() => {
    startListeningFlowRef.current = startListeningFlow;
  }, [startListeningFlow]);

  useEffect(() => {
    if (!enabled || disabled) {
      clearRecoveryTimer();
      clearSilenceTimer();
      stopActiveSession();

      if (isLockedMicStatus(stateRef.current.status)) {
        clearTranscript();
      } else {
        dispatch({ type: 'set_off' });
      }
      return;
    }

    if (hasTypedDraft) {
      clearRecoveryTimer();
      clearSilenceTimer();
      stopActiveSession();
      if (isLockedMicStatus(stateRef.current.status)) {
        clearTranscript();
      } else {
        dispatch({ type: 'set_off' });
      }
      return;
    }

    if (isPlaying) {
      clearRecoveryTimer();
      clearSilenceTimer();
      stopActiveSession();
      if (!isLockedMicStatus(stateRef.current.status)) {
        dispatch({ type: 'assistant_busy' });
      } else {
        clearTranscript();
      }
    }
  }, [
    clearRecoveryTimer,
    clearSilenceTimer,
    clearTranscript,
    hasTypedDraft,
    disabled,
    enabled,
    isPlaying,
    stopActiveSession
  ]);

  useEffect(() => {
    if (
      !shouldAttemptAutoListen({
        shouldAutoListen,
        hasUserActivation: hasUserActivatedListeningRef.current,
        enabled,
        disabled,
        isPlaying,
        hasTypedDraft,
        status: state.status
      })
    ) {
      return;
    }

    if (activeSessionRef.current || recoveryTimerRef.current || startInFlightRef.current) {
      return;
    }

    void startListeningFlow('auto');
  }, [disabled, enabled, hasTypedDraft, isPlaying, shouldAutoListen, startListeningFlow, state.status]);

  const pauseListening = useCallback(() => {
    logVoiceDebug('manual_pause');
    clearRecoveryTimer();
    clearSilenceTimer();
    stopActiveSession();
    dispatch({ type: 'pause_manual' });
  }, [clearRecoveryTimer, clearSilenceTimer, stopActiveSession]);

  const resumeListening = useCallback(() => {
    if (!enabledRef.current || disabledRef.current || hasTypedDraftRef.current || isPlayingRef.current) {
      return;
    }

    const fromStatus = stateRef.current.status;
    hasUserActivatedListeningRef.current = true;
    stateRef.current = {
      ...stateRef.current,
      status: 'off',
      recoveryAttempt: 0,
      transcript: '',
      error: null
    };
    logVoiceDebug('manual_resume', { fromStatus });
    dispatch({ type: 'set_off' });
    dispatch({ type: 'starting' });
    void startListeningFlow('resume');
  }, [startListeningFlow]);

  const interruptAndListen = useCallback(() => {
    logVoiceDebug('interrupt_and_listen', { fromStatus: stateRef.current.status });
    clearRecoveryTimer();
    clearSilenceTimer();
    onStopAudioRef.current();

    if (!enabledRef.current || disabledRef.current || hasTypedDraftRef.current) {
      return;
    }

    hasUserActivatedListeningRef.current = true;
    dispatch({ type: 'set_off' });
    dispatch({ type: 'starting' });
    void startListeningFlow('interrupt');
  }, [clearRecoveryTimer, clearSilenceTimer, startListeningFlow]);

  const armListeningActivation = useCallback(() => {
    hasUserActivatedListeningRef.current = true;

    if (!enabledRef.current || disabledRef.current) {
      return;
    }

    if (hasTypedDraftRef.current || isPlayingRef.current) {
      return;
    }

    const latestStatus = stateRef.current.status;
    if (latestStatus === 'paused_manual' || latestStatus === 'paused_recovery' || latestStatus === 'unsupported') {
      return;
    }

    if (activeSessionRef.current || recoveryTimerRef.current || startInFlightRef.current) {
      return;
    }

    dispatch({ type: 'set_off' });
    void startListeningFlow('auto');
  }, [startListeningFlow]);

  useEffect(() => {
    if (!__DEV__) {
      return;
    }

    logVoiceDebug('state_transition', {
      status: state.status,
      recoveryAttempt: state.recoveryAttempt,
      hasTranscript: state.transcript.length > 0,
      error: state.error
    });
  }, [state.error, state.recoveryAttempt, state.status, state.transcript]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearRecoveryTimer();
      clearSilenceTimer();
      stopActiveSession();
    };
  }, [clearRecoveryTimer, clearSilenceTimer, stopActiveSession]);

  const hint = useMemo(() => getVoiceConversationHint(state.status), [state.status]);

  return {
    isListening: state.status === 'listening',
    isManuallyPaused: state.status === 'paused_manual',
    transcript: state.transcript,
    error: state.error,
    status: state.status,
    hint,
    interruptAndListen,
    pauseListening,
    resumeListening,
    armListeningActivation
  };
}
