import type { VoiceConversationStatus } from '../../hooks/useVoiceConversation';

const RESTORABLE_MODE_SELECT_MIC_STATUSES = new Set<VoiceConversationStatus>([
  'starting',
  'listening',
  'assistant_busy',
  'recovering'
]);

export function shouldRestoreModeSelectMicAfterBlur(
  conversationModeEnabled: boolean,
  status: VoiceConversationStatus
): boolean {
  return conversationModeEnabled && RESTORABLE_MODE_SELECT_MIC_STATUSES.has(status);
}
