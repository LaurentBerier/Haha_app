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
 * toggle is disabled.
 */
export function shouldAutoPlayVoice(state: VoiceAutoplayPolicyState): boolean {
  return state.conversationModeEnabled || state.voiceAutoPlayEnabled;
}

export function toVoicePlaybackOutcome(result: VoiceAutoplayAttemptResultDetailed): VoicePlaybackOutcome {
  return {
    state: result.state,
    failureReason: result.failureReason
  };
}
