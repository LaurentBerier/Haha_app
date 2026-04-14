import { resolveGreetingAutoMicDecision } from '../app/mode-select/greetingAutoMic';

function buildBaseParams() {
  return {
    hasPendingGreetingMessageId: true,
    hasAlreadyTriggered: false,
    hasManualOverride: false,
    injectedType: 'greeting',
    isModeSelectScreenFocused: true,
    isValidConversation: true,
    isQuotaBlocked: false,
    hasTypedDraft: false,
    hasStreaming: false,
    isGreetingVoiceActive: false,
    isGreetingBooting: false,
    conversationModeEnabled: true,
    isIosMobileWebRuntime: false
  } as const;
}

describe('modeSelect greeting auto-mic', () => {
  it('forces enable without resume for tutorial greeting on iOS mobile web', () => {
    const decision = resolveGreetingAutoMicDecision({
      ...buildBaseParams(),
      injectedType: 'tutorial_greeting',
      isIosMobileWebRuntime: true
    });

    expect(decision).toBe('force_enable_without_resume');
  });

  it('forces enable + resume for tutorial greeting when conversation mode is off', () => {
    const decision = resolveGreetingAutoMicDecision({
      ...buildBaseParams(),
      injectedType: 'tutorial_greeting',
      conversationModeEnabled: false
    });

    expect(decision).toBe('force_enable_and_resume');
  });

  it('forces enable + resume for tutorial greeting when conversation mode is already on', () => {
    const decision = resolveGreetingAutoMicDecision({
      ...buildBaseParams(),
      injectedType: 'tutorial_greeting',
      conversationModeEnabled: true
    });

    expect(decision).toBe('force_enable_and_resume');
  });

  it('consumes greeting without auto-arm when non-tutorial greeting arrives with conversation mode off', () => {
    const decision = resolveGreetingAutoMicDecision({
      ...buildBaseParams(),
      injectedType: 'greeting',
      conversationModeEnabled: false
    });

    expect(decision).toBe('consume_without_auto_arm');
  });

  it('auto-arms listening for non-tutorial greeting when conversation mode is on', () => {
    const decision = resolveGreetingAutoMicDecision({
      ...buildBaseParams(),
      injectedType: 'greeting',
      conversationModeEnabled: true
    });

    expect(decision).toBe('arm_listening');
  });

  it('skips when blocking conditions are present', () => {
    const streamingBlocked = resolveGreetingAutoMicDecision({
      ...buildBaseParams(),
      hasStreaming: true
    });
    const draftBlocked = resolveGreetingAutoMicDecision({
      ...buildBaseParams(),
      hasTypedDraft: true
    });
    const inactiveScreenBlocked = resolveGreetingAutoMicDecision({
      ...buildBaseParams(),
      isModeSelectScreenFocused: false
    });
    const bootingBlocked = resolveGreetingAutoMicDecision({
      ...buildBaseParams(),
      injectedType: 'tutorial_greeting',
      isGreetingBooting: true
    });

    expect(streamingBlocked).toBe('skip');
    expect(draftBlocked).toBe('skip');
    expect(inactiveScreenBlocked).toBe('skip');
    expect(bootingBlocked).toBe('skip');
  });

  it('consumes without auto-arm when this greeting was manually overridden or already handled', () => {
    const manualOverrideDecision = resolveGreetingAutoMicDecision({
      ...buildBaseParams(),
      hasManualOverride: true,
      injectedType: 'tutorial_greeting'
    });
    const alreadyTriggeredDecision = resolveGreetingAutoMicDecision({
      ...buildBaseParams(),
      hasAlreadyTriggered: true
    });

    expect(manualOverrideDecision).toBe('consume_without_auto_arm');
    expect(alreadyTriggeredDecision).toBe('consume_without_auto_arm');
  });
});
