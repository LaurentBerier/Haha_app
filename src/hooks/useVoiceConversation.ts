import { Platform } from 'react-native';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { t } from '../i18n';
import {
  DEFAULT_BUSY_LOADING_TIMEOUT_MS,
  DEFAULT_SILENCE_AUTO_SEND_MS,
  ENV_BUSY_LOADING_TIMEOUT_MS,
  ENV_SILENCE_TIMEOUT_MS,
  MIN_BUSY_LOADING_TIMEOUT_MS,
  MIN_SILENCE_AUTO_SEND_MS,
  VOICE_RECOVERY_DELAYS_MS
} from '../contracts/conversationContracts';
import {
  requestVoicePermission,
  startVoiceListeningSession,
  type VoiceListeningEndEvent,
  type VoiceListeningSession,
  type VoiceSessionEndReason
} from '../services/voiceEngine';

const parsedSilenceTimeout = Number.parseInt(process.env[ENV_SILENCE_TIMEOUT_MS] ?? '', 10);
const SILENCE_TIMEOUT_MS =
  Number.isFinite(parsedSilenceTimeout) && parsedSilenceTimeout >= MIN_SILENCE_AUTO_SEND_MS
    ? parsedSilenceTimeout
    : DEFAULT_SILENCE_AUTO_SEND_MS;
const parsedBusyLoadingTimeout = Number.parseInt(process.env[ENV_BUSY_LOADING_TIMEOUT_MS] ?? '', 10);
const BUSY_LOADING_TIMEOUT_MS =
  Number.isFinite(parsedBusyLoadingTimeout) && parsedBusyLoadingTimeout >= MIN_BUSY_LOADING_TIMEOUT_MS
    ? parsedBusyLoadingTimeout
    : DEFAULT_BUSY_LOADING_TIMEOUT_MS;
const RECOVERY_DELAYS_MS = VOICE_RECOVERY_DELAYS_MS;
const WEB_VOICE_LIVENESS_MS = 5_000;
export const VOICE_DUPLICATE_SEND_WINDOW_MS = 3_000;

const GARBLED_STT_STANDALONE_WORDS = new Set([
  // French articles & determiners
  'le',
  'la',
  'les',
  'un',
  'une',
  'des',
  'du',
  'ce',
  'cet',
  'cette',
  'ces',
  // French prepositions
  'de',
  'en',
  'au',
  'aux',
  'par',
  'sur',
  'sous',
  'dans',
  'avec',
  'pour',
  // French conjunctions
  'et',
  'ou',
  'mais',
  'donc',
  'or',
  'ni',
  'car',
  // English articles & determiners
  'the',
  'a',
  'an',
  // English prepositions
  'in',
  'of',
  'to',
  'at',
  'by',
  'for',
  'on',
  'up',
  // English conjunctions
  'and',
  'or',
  'but',
  'if'
]);

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
  isAudioPlaybackLoading?: boolean;
  hasTypedDraft?: boolean;
  onSend: (text: string) => void;
  onStopAudio: () => void;
  language: string;
  fallbackLanguage?: string;
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
  webTabActive?: boolean;
}

interface VoiceConversationState {
  status: VoiceConversationStatus;
  transcript: string;
  error: string | null;
  recoveryAttempt: number;
}

interface DraftResumeState {
  hasTypedDraft: boolean;
  status: VoiceConversationStatus;
  hasActiveSession: boolean;
}

interface ManualResumeQueueState {
  enabled: boolean;
  disabled: boolean;
  hasTypedDraft: boolean;
  isPlaying: boolean;
}

interface PendingManualResumeBlockersState {
  isPlaying: boolean;
  startInFlight: boolean;
  hasActiveSession: boolean;
  hasRecoveryTimer: boolean;
}

interface BusyLoadingRecoveryState {
  enabled: boolean;
  disabled: boolean;
  hasTypedDraft: boolean;
  isAudioPlaybackLoading: boolean;
  status: VoiceConversationStatus;
  startInFlight: boolean;
  hasActiveSession: boolean;
  hasRecoveryTimer: boolean;
}

interface WebFocusSuspendState {
  enabled: boolean;
  disabled: boolean;
  hasTypedDraft: boolean;
  isPlaying: boolean;
  status: VoiceConversationStatus;
  hasActiveSession: boolean;
  hasRecoveryTimer: boolean;
}

interface WebFocusResumeState {
  shouldResume: boolean;
  webTabActive: boolean;
  enabled: boolean;
  disabled: boolean;
  hasTypedDraft: boolean;
  isPlaying: boolean;
  hasUserActivation: boolean;
  status: VoiceConversationStatus;
  hasActiveSession: boolean;
  hasRecoveryTimer: boolean;
  startInFlight: boolean;
}

export interface VoiceTranscriptDedupState {
  normalizedTranscript: string;
  lastNormalizedTranscript: string;
  nowMs: number;
  lastSentAtMs: number | null;
  windowMs?: number;
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

function isWebTabActive(): boolean {
  if (Platform.OS !== 'web') {
    return true;
  }

  if (typeof document === 'undefined') {
    return true;
  }

  const visible = document.visibilityState !== 'hidden';
  const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  return visible && focused;
}

export function shouldSuspendMicForWebFocusLoss(state: WebFocusSuspendState): boolean {
  if (!state.enabled || state.disabled || state.hasTypedDraft || state.isPlaying) {
    return false;
  }

  if (isLockedMicStatus(state.status)) {
    return false;
  }

  return (
    state.hasActiveSession ||
    state.hasRecoveryTimer ||
    state.status === 'starting' ||
    state.status === 'listening' ||
    state.status === 'recovering' ||
    state.status === 'assistant_busy'
  );
}

export function shouldResumeMicAfterWebFocusGain(state: WebFocusResumeState): boolean {
  if (!state.shouldResume || !state.webTabActive || !state.hasUserActivation) {
    return false;
  }

  if (!state.enabled || state.disabled || state.hasTypedDraft || state.isPlaying) {
    return false;
  }

  if (isLockedMicStatus(state.status)) {
    return false;
  }

  return !state.hasActiveSession && !state.hasRecoveryTimer && !state.startInFlight;
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

export function normalizeVoiceTranscriptForDedup(transcript: string): string {
  if (typeof transcript !== 'string') {
    return '';
  }

  return transcript
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shouldSuppressDuplicateVoiceTranscript(state: VoiceTranscriptDedupState): boolean {
  if (!state.normalizedTranscript || !state.lastNormalizedTranscript) {
    return false;
  }

  if (state.normalizedTranscript !== state.lastNormalizedTranscript) {
    return false;
  }

  if (typeof state.lastSentAtMs !== 'number' || !Number.isFinite(state.lastSentAtMs)) {
    return false;
  }

  const windowMs =
    typeof state.windowMs === 'number' && Number.isFinite(state.windowMs) && state.windowMs > 0
      ? state.windowMs
      : VOICE_DUPLICATE_SEND_WINDOW_MS;
  const elapsedMs = state.nowMs - state.lastSentAtMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return false;
  }

  return elapsedMs < windowMs;
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
  if (status === 'assistant_busy') {
    return t('micAssistantBusyHint');
  }
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
  const webTabActive = state.webTabActive ?? true;
  const canBypassWebActivationGate = Platform.OS === 'web' && state.status === 'assistant_busy';
  return (
    state.shouldAutoListen &&
    webTabActive &&
    (state.hasUserActivation || canBypassWebActivationGate) &&
    state.enabled &&
    !state.disabled &&
    !state.hasTypedDraft &&
    !state.isPlaying &&
    !isLockedMicStatus(state.status)
  );
}

export function shouldResumeMicAfterTypedDraft(state: DraftResumeState): boolean {
  if (!state.hasTypedDraft || isLockedMicStatus(state.status)) {
    return false;
  }

  return (
    state.hasActiveSession ||
    state.status === 'starting' ||
    state.status === 'listening' ||
    state.status === 'recovering' ||
    state.status === 'assistant_busy'
  );
}

export function shouldQueueManualResume(state: ManualResumeQueueState): boolean {
  if (state.disabled) {
    return false;
  }

  return !state.enabled || state.hasTypedDraft || state.isPlaying;
}

export function shouldArmBusyWhileQueuedResume(state: ManualResumeQueueState): boolean {
  return !state.disabled && state.enabled && !state.hasTypedDraft && state.isPlaying;
}

export function shouldDeferQueuedManualResume(state: PendingManualResumeBlockersState): boolean {
  return state.isPlaying || state.startInFlight || state.hasActiveSession || state.hasRecoveryTimer;
}

export function shouldRecoverFromBusyLoadingStall(state: BusyLoadingRecoveryState): boolean {
  if (!state.enabled || state.disabled || state.hasTypedDraft || !state.isAudioPlaybackLoading) {
    return false;
  }

  if (state.status !== 'assistant_busy') {
    return false;
  }

  return !state.startInFlight && !state.hasActiveSession && !state.hasRecoveryTimer;
}

export function useVoiceConversation({
  enabled,
  disabled,
  isPlaying,
  isAudioPlaybackLoading = false,
  hasTypedDraft = false,
  onSend,
  onStopAudio,
  language,
  fallbackLanguage = 'fr-CA',
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
  const busyLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livenessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeAfterTypedDraftRef = useRef(false);
  const pendingManualResumeRef = useRef(false);
  const hasUserActivatedListeningRef = useRef(Platform.OS !== 'web');
  const webTabActiveRef = useRef(isWebTabActive());
  const shouldResumeAfterWebFocusLossRef = useRef(false);
  const startListeningFlowRef = useRef<((origin: 'auto' | 'recovery' | 'resume' | 'interrupt') => Promise<void>) | null>(null);
  const enabledRef = useRef(enabled);
  const disabledRef = useRef(disabled);
  const isPlayingRef = useRef(isPlaying);
  const isAudioPlaybackLoadingRef = useRef(isAudioPlaybackLoading);
  const hasTypedDraftRef = useRef(hasTypedDraft);
  const onSendRef = useRef(onSend);
  const onStopAudioRef = useRef(onStopAudio);
  const languageRef = useRef(language);
  const fallbackLanguageRef = useRef(fallbackLanguage);
  const lastSentTranscriptNormalizedRef = useRef('');
  const lastSentTranscriptAtMsRef = useRef<number | null>(null);
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
    isAudioPlaybackLoadingRef.current = isAudioPlaybackLoading;
  }, [isAudioPlaybackLoading]);

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

  useEffect(() => {
    fallbackLanguageRef.current = fallbackLanguage;
  }, [fallbackLanguage]);

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

  const clearBusyLoadingTimer = useCallback(() => {
    if (!busyLoadingTimerRef.current) {
      return;
    }

    clearTimeout(busyLoadingTimerRef.current);
    busyLoadingTimerRef.current = null;
  }, []);

  const clearLivenessTimer = useCallback(() => {
    if (!livenessTimerRef.current) {
      return;
    }

    clearTimeout(livenessTimerRef.current);
    livenessTimerRef.current = null;
  }, []);

  const stopActiveSession = useCallback(() => {
    clearLivenessTimer();
    const activeSession = activeSessionRef.current;
    activeSessionRef.current = null;
    activeSession?.stop();
  }, [clearLivenessTimer]);

  const clearTranscript = useCallback(() => {
    dispatch({ type: 'clear_transcript' });
  }, []);

  const suspendMicForWebFocusLoss = useCallback(
    (reason: 'hidden' | 'blur') => {
      if (Platform.OS !== 'web') {
        return;
      }
      // #region agent log
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if(typeof window!=='undefined'){((window as any).__dbg=((window as any).__dbg||[])).push({t:Date.now(),l:'voice:focusLoss',d:{reason,status:stateRef.current.status,enabled:enabledRef.current}});console.warn('[DBG]voice:focusLoss',reason);}
      // #endregion

      webTabActiveRef.current = false;
      const shouldSuspend = shouldSuspendMicForWebFocusLoss({
        enabled: enabledRef.current,
        disabled: disabledRef.current,
        hasTypedDraft: hasTypedDraftRef.current,
        isPlaying: isPlayingRef.current,
        status: stateRef.current.status,
        hasActiveSession: Boolean(activeSessionRef.current),
        hasRecoveryTimer: Boolean(recoveryTimerRef.current)
      });
      if (!shouldSuspend) {
        return;
      }

      shouldResumeAfterWebFocusLossRef.current = true;
      logVoiceDebug('web_focus_loss_suspend', { reason, status: stateRef.current.status });
      clearRecoveryTimer();
      clearSilenceTimer();
      stopActiveSession();
      if (isLockedMicStatus(stateRef.current.status)) {
        clearTranscript();
      } else {
        dispatch({ type: 'set_off' });
      }
    },
    [clearRecoveryTimer, clearSilenceTimer, clearTranscript, stopActiveSession]
  );

  const resumeMicAfterWebFocusGain = useCallback(
    (reason: 'visible' | 'focus') => {
      if (Platform.OS !== 'web') {
        return;
      }

      webTabActiveRef.current = isWebTabActive();
      const shouldResume = shouldResumeMicAfterWebFocusGain({
        shouldResume: shouldResumeAfterWebFocusLossRef.current,
        webTabActive: webTabActiveRef.current,
        enabled: enabledRef.current,
        disabled: disabledRef.current,
        hasTypedDraft: hasTypedDraftRef.current,
        isPlaying: isPlayingRef.current,
        hasUserActivation: hasUserActivatedListeningRef.current,
        status: stateRef.current.status,
        hasActiveSession: Boolean(activeSessionRef.current),
        hasRecoveryTimer: Boolean(recoveryTimerRef.current),
        startInFlight: startInFlightRef.current
      });
      if (!shouldResume) {
        return;
      }

      shouldResumeAfterWebFocusLossRef.current = false;
      logVoiceDebug('web_focus_gain_resume', { reason, status: stateRef.current.status });
      dispatch({ type: 'set_off' });
      dispatch({ type: 'starting' });
      void startListeningFlowRef.current?.('resume');
    },
    []
  );

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

      const words = textToSend.split(/\s+/).filter(Boolean);
      const singleWord = words.length === 1 ? words[0] : undefined;
      if (singleWord !== undefined && GARBLED_STT_STANDALONE_WORDS.has(singleWord.toLowerCase())) {
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

      const normalizedTranscript = normalizeVoiceTranscriptForDedup(textToSend);
      const nowMs = Date.now();
      if (
        shouldSuppressDuplicateVoiceTranscript({
          normalizedTranscript,
          lastNormalizedTranscript: lastSentTranscriptNormalizedRef.current,
          nowMs,
          lastSentAtMs: lastSentTranscriptAtMsRef.current,
          windowMs: VOICE_DUPLICATE_SEND_WINDOW_MS
        })
      ) {
        if (__DEV__) {
          const lastSentAtMs = lastSentTranscriptAtMsRef.current;
          const elapsedMs = typeof lastSentAtMs === 'number' ? nowMs - lastSentAtMs : null;
          logVoiceDebug('duplicate_transcript_suppressed', {
            elapsedMs,
            windowMs: VOICE_DUPLICATE_SEND_WINDOW_MS
          });
        }
        clearTranscript();
        return;
      }

      try {
        onSendRef.current(textToSend);
        lastSentTranscriptNormalizedRef.current = normalizedTranscript;
        lastSentTranscriptAtMsRef.current = nowMs;
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
      // #region agent log
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if(typeof window!=='undefined'){((window as any).__dbg=((window as any).__dbg||[])).push({t:Date.now(),l:'voice:sessionEnd',d:{sid:event.sessionId,reason:event.reason,msg:event.message?.slice(0,80),recAttempt:stateRef.current.recoveryAttempt,enabled:enabledRef.current,disabled:disabledRef.current,status:stateRef.current.status,isPlaying:isPlayingRef.current}});console.warn('[DBG]voice:sessionEnd',event.reason);}
      // #endregion

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
              webTabActive: webTabActiveRef.current,
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
        // #region agent log
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if(typeof window!=='undefined'){((window as any).__dbg=((window as any).__dbg||[])).push({t:Date.now(),l:'voice:startBlocked',d:{origin,reason:'inFlight'}});console.warn('[DBG]voice:startBlocked inFlight',origin);}
        // #endregion
        return;
      }

      const latestStatus = stateRef.current.status;
      const canStart =
        origin === 'auto' || origin === 'recovery'
          ? shouldAttemptAutoListen({
              shouldAutoListen,
              webTabActive: webTabActiveRef.current,
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
            !isPlayingRef.current &&
            webTabActiveRef.current;

      if (!canStart) {
        // #region agent log
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if(typeof window!=='undefined'){((window as any).__dbg=((window as any).__dbg||[])).push({t:Date.now(),l:'voice:startBlocked',d:{origin,reason:'cannotStart',status:latestStatus,enabled:enabledRef.current,disabled:disabledRef.current,isPlaying:isPlayingRef.current,hasTypedDraft:hasTypedDraftRef.current,webTabActive:webTabActiveRef.current,hasUserActivation:hasUserActivatedListeningRef.current}});console.warn('[DBG]voice:startBlocked',origin);}
        // #endregion
        return;
      }

      // #region agent log
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if(typeof window!=='undefined'){((window as any).__dbg=((window as any).__dbg||[])).push({t:Date.now(),l:'voice:startOK',d:{origin,status:latestStatus}});console.warn('[DBG]voice:startOK',origin);}
      // #endregion
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
              webTabActive: webTabActiveRef.current,
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
              !isPlayingRef.current &&
              webTabActiveRef.current;

        if (!stillAllowed) {
          dispatch({ type: 'set_off' });
          return;
        }

        logVoiceDebug('session_start', {
          origin,
          statusBeforeStart: latestStatus,
          recoveryAttempt: stateRef.current.recoveryAttempt
        });

        let audioStartFired = false;
        let resultReceived = false;
        clearLivenessTimer();
        const audioStartTimeoutId = setTimeout(() => {
          if (!audioStartFired && isMountedRef.current) {
            dispatch({ type: 'listening' });
          }
        }, 1000);

        const session = startVoiceListeningSession({
          locale: languageRef.current,
          fallbackLocale: fallbackLanguageRef.current,
          onResult: (event) => {
            resultReceived = true;
            clearLivenessTimer();
            handleSessionResult(event.sessionId, event.transcript);
          },
          onEnd: (event) => {
            clearTimeout(audioStartTimeoutId);
            clearLivenessTimer();
            handleSessionEnd(event);
          },
          onAudioStart: () => {
            audioStartFired = true;
            clearTimeout(audioStartTimeoutId);
            if (Platform.OS === 'web') {
              clearLivenessTimer();
              livenessTimerRef.current = setTimeout(() => {
                livenessTimerRef.current = null;
                if (!resultReceived && activeSessionRef.current?.id === session.id && isMountedRef.current) {
                  // #region agent log
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  if(typeof window!=='undefined'){((window as any).__dbg=((window as any).__dbg||[])).push({t:Date.now(),l:'voice:livenessKill',d:{sid:session.id}});console.warn('[DBG]voice:livenessKill',session.id);}
                  fetch('http://127.0.0.1:7589/ingest/a8ac1d46-cb01-432f-baa8-71bc84b7e043',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'da8964'},body:JSON.stringify({sessionId:'da8964',location:'useVoiceConversation.ts:liveness',message:'voice:livenessKill',data:{sid:session.id},timestamp:Date.now()})}).catch(()=>{});
                  // #endregion
                  logVoiceDebug('liveness_watchdog_kill', { sessionId: session.id });
                  session.stop();
                }
              }, WEB_VOICE_LIVENESS_MS);
            }
            if (isMountedRef.current) {
              dispatch({ type: 'listening' });
            }
          }
        });

        if (!isMountedRef.current) {
          clearTimeout(audioStartTimeoutId);
          session.stop();
          return;
        }

        activeSessionRef.current = session;
      } finally {
        startInFlightRef.current = false;
      }
    },
    [
      clearLivenessTimer,
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
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    webTabActiveRef.current = isWebTabActive();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        suspendMicForWebFocusLoss('hidden');
        return;
      }

      resumeMicAfterWebFocusGain('visible');
    };

    const handleWindowBlur = () => {
      suspendMicForWebFocusLoss('blur');
    };

    const handleWindowFocus = () => {
      resumeMicAfterWebFocusGain('focus');
    };

    const handlePageHide = () => {
      suspendMicForWebFocusLoss('hidden');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [resumeMicAfterWebFocusGain, suspendMicForWebFocusLoss]);

  useEffect(() => {
    if (!enabled || disabled) {
      shouldResumeAfterWebFocusLossRef.current = false;
      resumeAfterTypedDraftRef.current = false;
      if (disabled) {
        pendingManualResumeRef.current = false;
      }
      clearBusyLoadingTimer();
      clearRecoveryTimer();
      clearSilenceTimer();
      stopActiveSession();
      dispatch({ type: 'set_off' });
      return;
    }

    if (hasTypedDraft) {
      shouldResumeAfterWebFocusLossRef.current = false;
      resumeAfterTypedDraftRef.current = shouldResumeMicAfterTypedDraft({
        hasTypedDraft: true,
        status: stateRef.current.status,
        hasActiveSession: Boolean(activeSessionRef.current)
      });
      clearBusyLoadingTimer();
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

    if (pendingManualResumeRef.current) {
      if (
        shouldDeferQueuedManualResume({
          isPlaying,
          startInFlight: startInFlightRef.current,
          hasActiveSession: Boolean(activeSessionRef.current),
          hasRecoveryTimer: Boolean(recoveryTimerRef.current)
        })
      ) {
        if (shouldArmBusyWhileQueuedResume({ enabled, disabled, hasTypedDraft, isPlaying })) {
          dispatch({ type: 'assistant_busy' });
        }
        return;
      }

      pendingManualResumeRef.current = false;
      resumeAfterTypedDraftRef.current = false;
      const fromStatus = stateRef.current.status;
      hasUserActivatedListeningRef.current = true;
      logVoiceDebug('manual_resume_flushed', { fromStatus });
      dispatch({ type: 'set_off' });
      dispatch({ type: 'starting' });
      void startListeningFlow('resume');
      return;
    }

    if (resumeAfterTypedDraftRef.current) {
      if (isPlaying || startInFlightRef.current || activeSessionRef.current || recoveryTimerRef.current) {
        return;
      }

      resumeAfterTypedDraftRef.current = false;
      const fromStatus = stateRef.current.status;
      hasUserActivatedListeningRef.current = true;
      logVoiceDebug('typed_draft_resume', { fromStatus });
      dispatch({ type: 'set_off' });
      dispatch({ type: 'starting' });
      void startListeningFlow('resume');
      return;
    }

    // Stop the active recording as soon as audio starts loading (not just when it starts
    // playing). On iOS, the recording session holds PlayAndRecord mode which routes audio
    // to the earpiece; releasing it before playback lets the OS switch to the loudspeaker
    // before the first audio frame is delivered.
    if (isPlaying || isAudioPlaybackLoading) {
      clearRecoveryTimer();
      clearSilenceTimer();
      stopActiveSession();
      if (!isLockedMicStatus(stateRef.current.status)) {
        dispatch({ type: 'assistant_busy' });
      } else {
        clearTranscript();
      }
      return;
    }

    clearBusyLoadingTimer();
  }, [
    clearBusyLoadingTimer,
    clearRecoveryTimer,
    clearSilenceTimer,
    clearTranscript,
    hasTypedDraft,
    disabled,
    enabled,
    isAudioPlaybackLoading,
    isPlaying,
    startListeningFlow,
    stopActiveSession
  ]);

  useEffect(() => {
    if (
      !shouldRecoverFromBusyLoadingStall({
        enabled,
        disabled,
        hasTypedDraft,
        isAudioPlaybackLoading,
        status: state.status,
        startInFlight: startInFlightRef.current,
        hasActiveSession: Boolean(activeSessionRef.current),
        hasRecoveryTimer: Boolean(recoveryTimerRef.current)
      })
    ) {
      clearBusyLoadingTimer();
      return;
    }

    if (busyLoadingTimerRef.current) {
      return;
    }

    busyLoadingTimerRef.current = setTimeout(() => {
      busyLoadingTimerRef.current = null;
      if (
        !isMountedRef.current ||
        !shouldRecoverFromBusyLoadingStall({
          enabled: enabledRef.current,
          disabled: disabledRef.current,
          hasTypedDraft: hasTypedDraftRef.current,
          isAudioPlaybackLoading: isAudioPlaybackLoadingRef.current,
          status: stateRef.current.status,
          startInFlight: startInFlightRef.current,
          hasActiveSession: Boolean(activeSessionRef.current),
          hasRecoveryTimer: Boolean(recoveryTimerRef.current)
        })
      ) {
        return;
      }

      logVoiceDebug('busy_loading_stall_reset', {
        status: stateRef.current.status,
        isPlaying: isPlayingRef.current
      });
      pendingManualResumeRef.current = true;
      onStopAudioRef.current();
      dispatch({ type: 'set_off' });
    }, BUSY_LOADING_TIMEOUT_MS);
  }, [clearBusyLoadingTimer, disabled, enabled, hasTypedDraft, isAudioPlaybackLoading, state.status]);

  useEffect(() => {
    if (
      !shouldAttemptAutoListen({
        shouldAutoListen,
        webTabActive: webTabActiveRef.current,
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
    shouldResumeAfterWebFocusLossRef.current = false;
    pendingManualResumeRef.current = false;
    resumeAfterTypedDraftRef.current = false;
    clearBusyLoadingTimer();
    clearRecoveryTimer();
    clearSilenceTimer();
    stopActiveSession();
    dispatch({ type: 'pause_manual' });
  }, [clearBusyLoadingTimer, clearRecoveryTimer, clearSilenceTimer, stopActiveSession]);

  const resumeListening = useCallback(() => {
    shouldResumeAfterWebFocusLossRef.current = false;
    clearBusyLoadingTimer();
    if (disabledRef.current) {
      pendingManualResumeRef.current = false;
      return;
    }

    if (
      shouldQueueManualResume({
        enabled: enabledRef.current,
        disabled: disabledRef.current,
        hasTypedDraft: hasTypedDraftRef.current,
        isPlaying: isPlayingRef.current
      })
    ) {
      const queueState = {
        enabled: enabledRef.current,
        disabled: disabledRef.current,
        hasTypedDraft: hasTypedDraftRef.current,
        isPlaying: isPlayingRef.current
      };
      pendingManualResumeRef.current = true;
      hasUserActivatedListeningRef.current = true;
      if (shouldArmBusyWhileQueuedResume(queueState)) {
        dispatch({ type: 'assistant_busy' });
      }
      logVoiceDebug('manual_resume_queued', {
        enabled: queueState.enabled,
        hasTypedDraft: queueState.hasTypedDraft,
        isPlaying: queueState.isPlaying,
        armedBusy: shouldArmBusyWhileQueuedResume(queueState),
        fromStatus: stateRef.current.status
      });
      return;
    }

    pendingManualResumeRef.current = false;
    resumeAfterTypedDraftRef.current = false;
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
  }, [clearBusyLoadingTimer, startListeningFlow]);

  const interruptAndListen = useCallback(() => {
    logVoiceDebug('interrupt_and_listen', { fromStatus: stateRef.current.status });
    shouldResumeAfterWebFocusLossRef.current = false;
    pendingManualResumeRef.current = false;
    resumeAfterTypedDraftRef.current = false;
    clearBusyLoadingTimer();
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
  }, [clearBusyLoadingTimer, clearRecoveryTimer, clearSilenceTimer, startListeningFlow]);

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
      shouldResumeAfterWebFocusLossRef.current = false;
      clearBusyLoadingTimer();
      clearRecoveryTimer();
      clearSilenceTimer();
      stopActiveSession();
    };
  }, [clearBusyLoadingTimer, clearRecoveryTimer, clearSilenceTimer, stopActiveSession]);

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
