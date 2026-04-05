import { shouldDowngradeVoiceAfterPlaybackFailure } from './chatBubbleVoicePlayback';

describe('chatBubbleVoicePlayback', () => {
  it('downgrades replayable metadata after hard playback failures', () => {
    expect(shouldDowngradeVoiceAfterPlaybackFailure('playback_error')).toBe(true);
    expect(shouldDowngradeVoiceAfterPlaybackFailure('invalid_queue')).toBe(true);
  });

  it('keeps voice metadata for recoverable autoplay outcomes', () => {
    expect(shouldDowngradeVoiceAfterPlaybackFailure('web_autoplay_blocked')).toBe(false);
    expect(shouldDowngradeVoiceAfterPlaybackFailure('interrupted')).toBe(false);
    expect(shouldDowngradeVoiceAfterPlaybackFailure(null)).toBe(false);
  });
});
