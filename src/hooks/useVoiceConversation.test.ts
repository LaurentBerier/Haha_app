jest.mock('react-native', () => ({
  Platform: {
    OS: 'web'
  }
}));

jest.mock('../i18n', () => ({
  t: (value: string) => value
}));

jest.mock('../services/voiceEngine', () => ({
  requestVoicePermission: jest.fn(),
  startVoiceListeningSession: jest.fn()
}));

import {
  getVoiceConversationHint,
  getVoiceRecoveryPlan,
  getVoiceRecoveryDelayMs,
  shouldResumeMicAfterWebFocusGain,
  shouldArmBusyWhileQueuedResume,
  shouldDeferQueuedManualResume,
  shouldQueueManualResume,
  shouldResumeMicAfterTypedDraft,
  shouldSuspendMicForWebFocusLoss,
  shouldAttemptAutoListen,
  shouldConsumeVoiceRecoveryBudget
} from './useVoiceConversation';

describe('useVoiceConversation helpers', () => {
  it('blocks auto-listen while manually paused', () => {
    expect(
      shouldAttemptAutoListen({
        shouldAutoListen: true,
        webTabActive: true,
        hasUserActivation: true,
        enabled: true,
        disabled: false,
        isPlaying: false,
        hasTypedDraft: false,
        status: 'paused_manual'
      })
    ).toBe(false);
  });

  it('blocks auto-listen when recovery is exhausted or unsupported', () => {
    expect(
      shouldAttemptAutoListen({
        shouldAutoListen: true,
        webTabActive: true,
        hasUserActivation: true,
        enabled: true,
        disabled: false,
        isPlaying: false,
        hasTypedDraft: false,
        status: 'paused_recovery'
      })
    ).toBe(false);

    expect(
      shouldAttemptAutoListen({
        shouldAutoListen: true,
        webTabActive: true,
        hasUserActivation: true,
        enabled: true,
        disabled: false,
        isPlaying: false,
        hasTypedDraft: false,
        status: 'unsupported'
      })
    ).toBe(false);
  });

  it('allows auto-listen from active non-blocking states', () => {
    expect(
      shouldAttemptAutoListen({
        shouldAutoListen: true,
        webTabActive: true,
        hasUserActivation: true,
        enabled: true,
        disabled: false,
        isPlaying: false,
        hasTypedDraft: false,
        status: 'assistant_busy'
      })
    ).toBe(true);
  });

  it('blocks auto-listen while the user has a typed draft', () => {
    expect(
      shouldAttemptAutoListen({
        shouldAutoListen: true,
        hasUserActivation: true,
        enabled: true,
        disabled: false,
        isPlaying: false,
        hasTypedDraft: true,
        status: 'off'
      })
    ).toBe(false);
  });

  it('blocks auto-listen on web until the user explicitly activates mic once', () => {
    expect(
      shouldAttemptAutoListen({
        shouldAutoListen: true,
        webTabActive: true,
        hasUserActivation: false,
        enabled: true,
        disabled: false,
        isPlaying: false,
        hasTypedDraft: false,
        status: 'off'
      })
    ).toBe(false);
  });

  it('blocks auto-listen on web when tab is not active', () => {
    expect(
      shouldAttemptAutoListen({
        shouldAutoListen: true,
        webTabActive: false,
        hasUserActivation: true,
        enabled: true,
        disabled: false,
        isPlaying: false,
        hasTypedDraft: false,
        status: 'off'
      })
    ).toBe(false);
  });

  it('flags draft interruptions that should auto-resume listening', () => {
    expect(
      shouldResumeMicAfterTypedDraft({
        hasTypedDraft: true,
        status: 'listening',
        hasActiveSession: true
      })
    ).toBe(true);

    expect(
      shouldResumeMicAfterTypedDraft({
        hasTypedDraft: true,
        status: 'assistant_busy',
        hasActiveSession: false
      })
    ).toBe(true);
  });

  it('does not auto-resume from draft when status is locked or no draft exists', () => {
    expect(
      shouldResumeMicAfterTypedDraft({
        hasTypedDraft: false,
        status: 'listening',
        hasActiveSession: true
      })
    ).toBe(false);

    expect(
      shouldResumeMicAfterTypedDraft({
        hasTypedDraft: true,
        status: 'paused_manual',
        hasActiveSession: true
      })
    ).toBe(false);
  });

  it('queues manual resume until mode is re-enabled or playback/text locks are cleared', () => {
    expect(
      shouldQueueManualResume({
        enabled: false,
        disabled: false,
        hasTypedDraft: false,
        isPlaying: false
      })
    ).toBe(true);

    expect(
      shouldQueueManualResume({
        enabled: true,
        disabled: false,
        hasTypedDraft: true,
        isPlaying: false
      })
    ).toBe(true);

    expect(
      shouldQueueManualResume({
        enabled: true,
        disabled: false,
        hasTypedDraft: false,
        isPlaying: true
      })
    ).toBe(true);
  });

  it('does not queue manual resume when conversation is hard-disabled', () => {
    expect(
      shouldQueueManualResume({
        enabled: true,
        disabled: true,
        hasTypedDraft: false,
        isPlaying: false
      })
    ).toBe(false);
  });

  it('arms assistant-busy UI when queued resume is blocked only by audio playback', () => {
    expect(
      shouldArmBusyWhileQueuedResume({
        enabled: true,
        disabled: false,
        hasTypedDraft: false,
        isPlaying: true
      })
    ).toBe(true);

    expect(
      shouldArmBusyWhileQueuedResume({
        enabled: true,
        disabled: false,
        hasTypedDraft: true,
        isPlaying: true
      })
    ).toBe(false);
  });

  it('defer queued resume while blocked, then allows flush once blockers are gone', () => {
    expect(
      shouldDeferQueuedManualResume({
        isPlaying: true,
        startInFlight: false,
        hasActiveSession: false,
        hasRecoveryTimer: false
      })
    ).toBe(true);

    expect(
      shouldDeferQueuedManualResume({
        isPlaying: false,
        startInFlight: false,
        hasActiveSession: false,
        hasRecoveryTimer: false
      })
    ).toBe(false);
  });

  it('returns the bounded recovery delays', () => {
    expect(getVoiceRecoveryDelayMs(1)).toBe(250);
    expect(getVoiceRecoveryDelayMs(2)).toBe(800);
    expect(getVoiceRecoveryDelayMs(3)).toBe(2000);
    expect(getVoiceRecoveryDelayMs(4)).toBeNull();
  });

  it('only consumes the bounded recovery budget for genuine error conditions', () => {
    expect(shouldConsumeVoiceRecoveryBudget('transient')).toBe(true);
    expect(shouldConsumeVoiceRecoveryBudget('aborted')).toBe(true);
    expect(shouldConsumeVoiceRecoveryBudget('no_speech')).toBe(false);
    expect(shouldConsumeVoiceRecoveryBudget('ended_unexpectedly')).toBe(false);
  });

  it('keeps silent web restarts out of the bounded recovery countdown', () => {
    expect(getVoiceRecoveryPlan('no_speech', 2)).toEqual({
      attempt: 2,
      delayMs: 250,
      consumesBudget: false
    });

    expect(getVoiceRecoveryPlan('ended_unexpectedly', 1)).toEqual({
      attempt: 1,
      delayMs: 250,
      consumesBudget: false
    });

    expect(getVoiceRecoveryPlan('transient', 2)).toEqual({
      attempt: 3,
      delayMs: 2000,
      consumesBudget: true
    });
  });

  it('returns explicit hints for paused and unsupported states', () => {
    expect(getVoiceConversationHint('paused_manual')).toBe('micPausedHint');
    expect(getVoiceConversationHint('paused_recovery')).toBe('micRecoveryPausedHint');
    expect(getVoiceConversationHint('unsupported')).toBe('micUnsupportedHint');
    expect(getVoiceConversationHint('listening')).toBeNull();
  });

  it('suspends mic on focus loss only when a live/auto-resumable session was active', () => {
    expect(
      shouldSuspendMicForWebFocusLoss({
        enabled: true,
        disabled: false,
        hasTypedDraft: false,
        isPlaying: false,
        status: 'listening',
        hasActiveSession: true,
        hasRecoveryTimer: false
      })
    ).toBe(true);

    expect(
      shouldSuspendMicForWebFocusLoss({
        enabled: true,
        disabled: false,
        hasTypedDraft: false,
        isPlaying: false,
        status: 'off',
        hasActiveSession: false,
        hasRecoveryTimer: false
      })
    ).toBe(false);
  });

  it('resumes mic after focus gain only when it was active before and conditions still allow it', () => {
    expect(
      shouldResumeMicAfterWebFocusGain({
        shouldResume: true,
        webTabActive: true,
        enabled: true,
        disabled: false,
        hasTypedDraft: false,
        isPlaying: false,
        hasUserActivation: true,
        status: 'off',
        hasActiveSession: false,
        hasRecoveryTimer: false,
        startInFlight: false
      })
    ).toBe(true);

    expect(
      shouldResumeMicAfterWebFocusGain({
        shouldResume: true,
        webTabActive: true,
        enabled: true,
        disabled: false,
        hasTypedDraft: false,
        isPlaying: false,
        hasUserActivation: true,
        status: 'paused_manual',
        hasActiveSession: false,
        hasRecoveryTimer: false,
        startInFlight: false
      })
    ).toBe(false);
  });
});
