import {
  hasPlayableGreetingVoice,
  shouldConfirmGreetingAutoplayFailure
} from './greetingVoiceFailure';

describe('greetingVoiceFailure', () => {
  it('detects playable voice from queue or direct url', () => {
    expect(hasPlayableGreetingVoice({ voiceQueue: ['https://example.com/chunk.mp3'] })).toBe(true);
    expect(hasPlayableGreetingVoice({ voiceUrl: 'https://example.com/voice.mp3' })).toBe(true);
    expect(hasPlayableGreetingVoice({ voiceQueue: ['   '], voiceUrl: '   ' })).toBe(false);
    expect(hasPlayableGreetingVoice(null)).toBe(false);
  });

  it('does not confirm failure while the same message is already playing/loading', () => {
    const shouldConfirm = shouldConfirmGreetingAutoplayFailure({
      state: 'failed',
      failureReason: 'playback_error',
      messageId: 'msg-greeting-1',
      isPlaying: true,
      isLoading: false,
      currentMessageId: 'msg-greeting-1',
      metadata: null
    });

    expect(shouldConfirm).toBe(false);
  });

  it('does not confirm interrupted failure when playable voice metadata exists', () => {
    const shouldConfirm = shouldConfirmGreetingAutoplayFailure({
      state: 'failed',
      failureReason: 'interrupted',
      messageId: 'msg-greeting-2',
      isPlaying: false,
      isLoading: false,
      currentMessageId: null,
      metadata: {
        voiceStatus: 'ready',
        voiceQueue: ['https://example.com/replayable.mp3']
      }
    });

    expect(shouldConfirm).toBe(false);
  });

  it('confirms non-interrupted failures when no active playback is detected', () => {
    const playbackError = shouldConfirmGreetingAutoplayFailure({
      state: 'failed',
      failureReason: 'playback_error',
      messageId: 'msg-greeting-3',
      isPlaying: false,
      isLoading: false,
      currentMessageId: null,
      metadata: {
        voiceStatus: 'ready',
        voiceUrl: 'https://example.com/generated.mp3'
      }
    });
    const invalidQueue = shouldConfirmGreetingAutoplayFailure({
      state: 'failed',
      failureReason: 'invalid_queue',
      messageId: 'msg-greeting-3',
      isPlaying: false,
      isLoading: false,
      currentMessageId: null,
      metadata: null
    });

    expect(playbackError).toBe(true);
    expect(invalidQueue).toBe(true);
  });

  it('never confirms when autoplay did not fail', () => {
    const started = shouldConfirmGreetingAutoplayFailure({
      state: 'started',
      failureReason: null,
      messageId: 'msg-greeting-4',
      isPlaying: false,
      isLoading: false,
      currentMessageId: null,
      metadata: null
    });
    const pending = shouldConfirmGreetingAutoplayFailure({
      state: 'pending_web_unlock',
      failureReason: null,
      messageId: 'msg-greeting-4',
      isPlaying: false,
      isLoading: false,
      currentMessageId: null,
      metadata: null
    });

    expect(started).toBe(false);
    expect(pending).toBe(false);
  });
});
