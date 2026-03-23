import { resolveChatBubbleVoiceControlState, resolveVoiceUnavailableTranslationKey } from './chatBubbleVoiceState';

describe('ChatBubble voice control state helpers', () => {
  it('returns ready when eligible and voiceUrl exists', () => {
    expect(
      resolveChatBubbleVoiceControlState({
        isEligible: true,
        voiceUrl: 'https://cdn.example.com/audio.mp3',
        voiceStatus: undefined
      })
    ).toBe('ready');
  });

  it('returns generating when eligible and voice status is generating', () => {
    expect(
      resolveChatBubbleVoiceControlState({
        isEligible: true,
        voiceUrl: '',
        voiceStatus: 'generating'
      })
    ).toBe('generating');
  });

  it('returns unavailable when eligible and no playable voice is present', () => {
    expect(
      resolveChatBubbleVoiceControlState({
        isEligible: true,
        voiceUrl: '',
        voiceStatus: 'unavailable'
      })
    ).toBe('unavailable');
  });

  it('returns hidden when message is not voice-eligible', () => {
    expect(
      resolveChatBubbleVoiceControlState({
        isEligible: false,
        voiceUrl: 'https://cdn.example.com/audio.mp3',
        voiceStatus: 'ready'
      })
    ).toBe('hidden');
  });

  it('maps voice error codes to user-facing reason keys', () => {
    expect(resolveVoiceUnavailableTranslationKey('RATE_LIMIT_EXCEEDED')).toBe('voiceUnavailableRateLimit');
    expect(resolveVoiceUnavailableTranslationKey('TTS_QUOTA_EXCEEDED')).toBe('voiceUnavailableQuota');
    expect(resolveVoiceUnavailableTranslationKey('TTS_FORBIDDEN')).toBe('voiceUnavailableForbidden');
    expect(resolveVoiceUnavailableTranslationKey('UNAUTHORIZED')).toBe('voiceUnavailableForbidden');
    expect(resolveVoiceUnavailableTranslationKey('TTS_PROVIDER_ERROR')).toBe('voiceUnavailableGeneric');
  });
});
