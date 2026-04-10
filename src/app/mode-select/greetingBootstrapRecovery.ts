interface ShouldRecoverGreetingBootstrapParams {
  artistId: string;
  greetingOpenCycle: number;
  isModeSelectScreenFocused: boolean;
  isGreetingGateSatisfied: boolean;
  modeSelectConversationId: string;
}

interface ShouldInsertGreetingFallbackParams {
  hasInsertedGreetingMessage: boolean;
  isRunActive: boolean;
  introConversationId: string;
}

export function shouldRecoverGreetingBootstrapConversation(
  params: ShouldRecoverGreetingBootstrapParams
): boolean {
  if (!params.artistId.trim()) {
    return false;
  }
  if (params.greetingOpenCycle <= 0) {
    return false;
  }
  if (!params.isModeSelectScreenFocused) {
    return false;
  }
  if (params.isGreetingGateSatisfied) {
    return false;
  }

  return params.modeSelectConversationId.trim().length === 0;
}

export function shouldInsertGreetingFallbackAfterFailure(
  params: ShouldInsertGreetingFallbackParams
): boolean {
  if (!params.isRunActive) {
    return false;
  }
  if (params.hasInsertedGreetingMessage) {
    return false;
  }

  return params.introConversationId.trim().length > 0;
}
