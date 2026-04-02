export type GreetingAutoMicDecision =
  | 'skip'
  | 'consume_without_auto_arm'
  | 'arm_listening'
  | 'force_enable_and_resume';

export interface ResolveGreetingAutoMicDecisionParams {
  hasPendingGreetingMessageId: boolean;
  hasAlreadyTriggered: boolean;
  hasManualOverride: boolean;
  injectedType: string | null | undefined;
  isModeSelectScreenFocused: boolean;
  isValidConversation: boolean;
  isQuotaBlocked: boolean;
  hasTypedDraft: boolean;
  hasStreaming: boolean;
  isGreetingVoiceActive: boolean;
  conversationModeEnabled: boolean;
}

function isEligibleGreetingInjectedType(value: string | null | undefined): value is 'greeting' | 'tutorial_greeting' {
  return value === 'greeting' || value === 'tutorial_greeting';
}

export function resolveGreetingAutoMicDecision(
  params: ResolveGreetingAutoMicDecisionParams
): GreetingAutoMicDecision {
  if (!params.hasPendingGreetingMessageId) {
    return 'skip';
  }

  if (params.hasAlreadyTriggered || params.hasManualOverride) {
    return 'consume_without_auto_arm';
  }

  if (!isEligibleGreetingInjectedType(params.injectedType)) {
    return 'skip';
  }

  if (
    !params.isModeSelectScreenFocused ||
    !params.isValidConversation ||
    params.isQuotaBlocked ||
    params.hasTypedDraft ||
    params.hasStreaming ||
    params.isGreetingVoiceActive
  ) {
    return 'skip';
  }

  if (params.injectedType === 'tutorial_greeting') {
    return 'force_enable_and_resume';
  }

  if (!params.conversationModeEnabled) {
    return 'consume_without_auto_arm';
  }

  return 'arm_listening';
}
