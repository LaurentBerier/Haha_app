import type { VoiceConversationStatus } from '../../hooks/useVoiceConversation';

const ACTIVE_MIC_STATES = new Set<VoiceConversationStatus>(['starting', 'listening', 'recovering']);
const PAUSED_MIC_STATES = new Set<VoiceConversationStatus>([
  'assistant_busy',
  'paused_manual',
  'paused_recovery',
  'unsupported',
  'error'
]);
const OFF_MIC_STATES = new Set<VoiceConversationStatus>([
  'assistant_busy',
  'off',
  'paused_manual',
  'paused_recovery',
  'unsupported',
  'error'
]);

export function isChatInputMicActive(micState: VoiceConversationStatus | null | undefined): boolean {
  return Boolean(micState && ACTIVE_MIC_STATES.has(micState));
}

export function isChatInputMicPaused(
  isConversationEnabled: boolean,
  micState: VoiceConversationStatus | null | undefined
): boolean {
  return Boolean(isConversationEnabled && micState && PAUSED_MIC_STATES.has(micState));
}

export function shouldUseOffMicAsset(
  isConversationEnabled: boolean,
  micState: VoiceConversationStatus | null | undefined
): boolean {
  if (!isConversationEnabled) {
    return true;
  }

  return Boolean(micState && OFF_MIC_STATES.has(micState));
}

export function shouldShowConversationHint(params: {
  hint: string | null | undefined;
  disabled: boolean;
  hasConversationError: boolean;
  hasValidationError: boolean;
  hasPickerError: boolean;
}): boolean {
  return Boolean(
    params.hint &&
      !params.disabled &&
      !params.hasConversationError &&
      !params.hasValidationError &&
      !params.hasPickerError
  );
}
