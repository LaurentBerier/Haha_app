import { shouldAutoPlayVoice } from '../../utils/voicePlaybackPolicy';

export interface GreetingAutoplayPolicyParams {
  conversationModeEnabled: boolean;
  voiceAutoPlayEnabled: boolean;
  forceAutoplay?: boolean;
  quotaBlocked?: boolean;
}

export interface PendingGreetingAutoplayPolicyParams extends GreetingAutoplayPolicyParams {
  hasPendingGreetingAudio: boolean;
}

export function shouldAutoPlayGreetingVoice(params: GreetingAutoplayPolicyParams): boolean {
  return shouldAutoPlayVoice({
    conversationModeEnabled: params.conversationModeEnabled,
    voiceAutoPlayEnabled: params.voiceAutoPlayEnabled,
    forceAutoplay: params.forceAutoplay,
    quotaBlocked: params.quotaBlocked
  });
}

export function shouldAutoPlayPendingGreetingVoice(params: PendingGreetingAutoplayPolicyParams): boolean {
  if (!params.hasPendingGreetingAudio) {
    return false;
  }

  return shouldAutoPlayGreetingVoice(params);
}
