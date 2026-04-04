jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({
      remove: jest.fn()
    }))
  },
  Platform: {
    OS: 'web'
  }
}));

import {
  DEFAULT_REPLAY_ON_FOCUS,
  resolveReplayTrackingStateAfterAttempt,
  resolveInterruptedReplayMessageId,
  shouldRetryPendingReplayWhenUnblocked,
  shouldAttemptInterruptedReplayOnAppActive,
  shouldReplayOnFocusLifecycle
} from './useAutoReplayLastArtistMessage';

describe('useAutoReplayLastArtistMessage helpers', () => {
  it('defaults focus replay to disabled', () => {
    expect(DEFAULT_REPLAY_ON_FOCUS).toBe(false);
  });

  it('disables focus replay when replayOnFocus is false', () => {
    expect(shouldReplayOnFocusLifecycle(true, false, true)).toBe(false);
  });

  it('disables focus replay when voice auto-play is off', () => {
    expect(shouldReplayOnFocusLifecycle(true, true, false)).toBe(false);
  });

  it('enables focus replay only when hook is enabled and replayOnFocus is true', () => {
    expect(shouldReplayOnFocusLifecycle(true, true, true)).toBe(true);
    expect(shouldReplayOnFocusLifecycle(false, true, true)).toBe(false);
  });

  it('captures interrupted replay message id only when app leaves active state while audio is active', () => {
    expect(
      resolveInterruptedReplayMessageId({
        nextState: 'background',
        isAudioActive: true,
        currentMessageId: 'msg-voice-1'
      })
    ).toBe('msg-voice-1');

    expect(
      resolveInterruptedReplayMessageId({
        nextState: 'inactive',
        isAudioActive: true,
        currentMessageId: ' msg-voice-2 '
      })
    ).toBe('msg-voice-2');

    expect(
      resolveInterruptedReplayMessageId({
        nextState: 'background',
        isAudioActive: false,
        currentMessageId: 'msg-voice-3'
      })
    ).toBeNull();

    expect(
      resolveInterruptedReplayMessageId({
        nextState: 'active',
        isAudioActive: true,
        currentMessageId: 'msg-voice-4'
      })
    ).toBeNull();
  });

  it('retries interrupted replay only on foreground when an interrupted message id exists', () => {
    expect(shouldAttemptInterruptedReplayOnAppActive('active', 'msg-voice-1')).toBe(true);
    expect(shouldAttemptInterruptedReplayOnAppActive('active', null)).toBe(false);
    expect(shouldAttemptInterruptedReplayOnAppActive('background', 'msg-voice-1')).toBe(false);
  });

  it('marks replay as started only when playback truly starts', () => {
    expect(resolveReplayTrackingStateAfterAttempt(null, 'msg-voice-1', 'started')).toEqual({
      nextLastStartedMessageId: 'msg-voice-1',
      nextPendingReplay: null
    });

    expect(resolveReplayTrackingStateAfterAttempt('msg-voice-1', 'msg-voice-2', 'failed')).toEqual({
      nextLastStartedMessageId: 'msg-voice-1',
      nextPendingReplay: null
    });

    expect(resolveReplayTrackingStateAfterAttempt('msg-voice-1', 'msg-voice-2', 'pending_web_unlock')).toEqual({
      nextLastStartedMessageId: 'msg-voice-1',
      nextPendingReplay: {
        messageId: 'msg-voice-2',
        status: 'pending_web_unlock'
      }
    });
  });

  it('retries pending blocker replay only when playback/stream blockers are gone', () => {
    expect(
      shouldRetryPendingReplayWhenUnblocked({
        pendingReplay: {
          messageId: 'msg-voice-1',
          status: 'pending_blockers'
        },
        hasStreaming: false,
        isPlaying: false,
        isLoading: false
      })
    ).toBe(true);

    expect(
      shouldRetryPendingReplayWhenUnblocked({
        pendingReplay: {
          messageId: 'msg-voice-1',
          status: 'pending_blockers'
        },
        hasStreaming: true,
        isPlaying: false,
        isLoading: false
      })
    ).toBe(false);

    expect(
      shouldRetryPendingReplayWhenUnblocked({
        pendingReplay: {
          messageId: 'msg-voice-1',
          status: 'pending_web_unlock'
        },
        hasStreaming: false,
        isPlaying: false,
        isLoading: false
      })
    ).toBe(false);
  });
});
