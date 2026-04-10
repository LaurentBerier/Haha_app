import {
  shouldInsertGreetingFallbackAfterFailure,
  shouldRecoverGreetingBootstrapConversation
} from '../../app/mode-select/greetingBootstrapRecovery';

describe('greetingBootstrapRecovery', () => {
  it('recovers intro conversation when gate is unsatisfied and no mode-select binding exists', () => {
    expect(
      shouldRecoverGreetingBootstrapConversation({
        artistId: 'cathy-gauthier',
        greetingOpenCycle: 1,
        isModeSelectScreenFocused: true,
        isGreetingGateSatisfied: false,
        modeSelectConversationId: ''
      })
    ).toBe(true);
  });

  it('does not recover when greeting gate is already satisfied or a binding already exists', () => {
    expect(
      shouldRecoverGreetingBootstrapConversation({
        artistId: 'cathy-gauthier',
        greetingOpenCycle: 1,
        isModeSelectScreenFocused: true,
        isGreetingGateSatisfied: true,
        modeSelectConversationId: ''
      })
    ).toBe(false);

    expect(
      shouldRecoverGreetingBootstrapConversation({
        artistId: 'cathy-gauthier',
        greetingOpenCycle: 1,
        isModeSelectScreenFocused: true,
        isGreetingGateSatisfied: false,
        modeSelectConversationId: 'conv-bound'
      })
    ).toBe(false);
  });

  it('inserts fallback greeting after failure only for active runs without a prior insert', () => {
    expect(
      shouldInsertGreetingFallbackAfterFailure({
        hasInsertedGreetingMessage: false,
        isRunActive: true,
        introConversationId: 'conv-1'
      })
    ).toBe(true);

    expect(
      shouldInsertGreetingFallbackAfterFailure({
        hasInsertedGreetingMessage: true,
        isRunActive: true,
        introConversationId: 'conv-1'
      })
    ).toBe(false);

    expect(
      shouldInsertGreetingFallbackAfterFailure({
        hasInsertedGreetingMessage: false,
        isRunActive: false,
        introConversationId: 'conv-1'
      })
    ).toBe(false);
  });
});
