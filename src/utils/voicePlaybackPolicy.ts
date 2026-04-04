import type { VoiceAutoplayAttemptResultDetailed } from '../services/voiceAutoplayService';

export interface VoiceAutoplayPolicyState {
  conversationModeEnabled: boolean;
  voiceAutoPlayEnabled: boolean;
  quotaBlocked?: boolean;
}

export interface VoicePlaybackOutcome {
  state: VoiceAutoplayAttemptResultDetailed['state'];
  failureReason: VoiceAutoplayAttemptResultDetailed['failureReason'];
}

/**
 * Conversation mode is hands-free: force autoplay even when the manual global
 * toggle is disabled, unless quota blocks the turn.
 */
export function shouldAutoPlayVoice(state: VoiceAutoplayPolicyState): boolean {
  const shouldAutoPlayByMode = state.conversationModeEnabled || state.voiceAutoPlayEnabled;
  if (!shouldAutoPlayByMode) {
    return false;
  }

  return !state.quotaBlocked;
}

export function toVoicePlaybackOutcome(result: VoiceAutoplayAttemptResultDetailed): VoicePlaybackOutcome {
  return {
    state: result.state,
    failureReason: result.failureReason
  };
}
