import {
  shouldAutoPlayGreetingVoice,
  shouldAutoPlayPendingGreetingVoice
} from '../../app/mode-select/greetingAutoplayPolicy';

describe('greetingAutoplayPolicy', () => {
  it('forces tutorial greeting autoplay when override is enabled', () => {
    expect(
      shouldAutoPlayGreetingVoice({
        conversationModeEnabled: false,
        voiceAutoPlayEnabled: false,
        forceAutoplay: true,
        quotaBlocked: false
      })
    ).toBe(true);
  });

  it('keeps pending greeting retry autoplay forced when override is enabled', () => {
    expect(
      shouldAutoPlayPendingGreetingVoice({
        hasPendingGreetingAudio: true,
        conversationModeEnabled: false,
        voiceAutoPlayEnabled: false,
        forceAutoplay: true,
        quotaBlocked: false
      })
    ).toBe(true);
  });

  it('does not autoplay pending greeting when no pending audio exists', () => {
    expect(
      shouldAutoPlayPendingGreetingVoice({
        hasPendingGreetingAudio: false,
        conversationModeEnabled: true,
        voiceAutoPlayEnabled: true,
        forceAutoplay: true,
        quotaBlocked: false
      })
    ).toBe(false);
  });
});
