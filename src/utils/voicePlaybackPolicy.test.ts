import { shouldAutoPlayVoice, toVoicePlaybackOutcome } from './voicePlaybackPolicy';

describe('voicePlaybackPolicy', () => {
  it('forces autoplay when tutorial override is enabled even with both toggles off', () => {
    expect(
      shouldAutoPlayVoice({
        conversationModeEnabled: false,
        voiceAutoPlayEnabled: false,
        forceAutoplay: true,
        quotaBlocked: false
      })
    ).toBe(true);
  });

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

  it('keeps autoplay disabled when no trigger is active', () => {
    expect(
      shouldAutoPlayVoice({
        conversationModeEnabled: false,
        voiceAutoPlayEnabled: false,
        forceAutoplay: false,
        quotaBlocked: false
      })
    ).toBe(false);
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
