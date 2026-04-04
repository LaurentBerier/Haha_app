import { shouldAutoPlayVoice, toVoicePlaybackOutcome } from './voicePlaybackPolicy';

describe('voicePlaybackPolicy', () => {
  it('forces autoplay in conversation mode even when manual autoplay is disabled', () => {
    expect(
      shouldAutoPlayVoice({
        conversationModeEnabled: true,
        voiceAutoPlayEnabled: false,
        quotaBlocked: false
      })
    ).toBe(true);
  });

  it('keeps autoplay enabled even when quota is blocked', () => {
    expect(
      shouldAutoPlayVoice({
        conversationModeEnabled: true,
        voiceAutoPlayEnabled: true,
        quotaBlocked: true
      })
    ).toBe(true);
  });

  it('keeps playback outcome distinct from synthesis status', () => {
    expect(
      toVoicePlaybackOutcome({
        state: 'failed',
        failureReason: 'playback_error'
      })
    ).toEqual({
      state: 'failed',
      failureReason: 'playback_error'
    });
  });
});
