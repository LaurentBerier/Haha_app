import {
  isChatInputMicActive,
  isChatInputMicPaused,
  shouldShowConversationHint,
  shouldUseOffMicAsset
} from './chatInputMicState';

describe('chatInputMicState', () => {
  it('treats starting and recovering as active mic states', () => {
    expect(isChatInputMicActive('starting')).toBe(true);
    expect(isChatInputMicActive('recovering')).toBe(true);
    expect(isChatInputMicActive('assistant_busy')).toBe(false);
  });

  it('uses the off mic asset when conversation mode is off or paused', () => {
    expect(shouldUseOffMicAsset(false, 'listening')).toBe(true);
    expect(shouldUseOffMicAsset(true, 'paused_manual')).toBe(true);
    expect(shouldUseOffMicAsset(true, 'unsupported')).toBe(true);
    expect(shouldUseOffMicAsset(true, 'assistant_busy')).toBe(true);
    expect(shouldUseOffMicAsset(true, 'listening')).toBe(false);
  });

  it('marks recovery and manual pause as paused ui states', () => {
    expect(isChatInputMicPaused(true, 'paused_manual')).toBe(true);
    expect(isChatInputMicPaused(true, 'paused_recovery')).toBe(true);
    expect(isChatInputMicPaused(true, 'listening')).toBe(false);
  });

  it('shows the mic hint only when no blocking error state is present', () => {
    expect(
      shouldShowConversationHint({
        hint: 'Mic paused',
        disabled: false,
        hasConversationError: false,
        hasValidationError: false,
        hasPickerError: false
      })
    ).toBe(true);

    expect(
      shouldShowConversationHint({
        hint: 'Mic paused',
        disabled: false,
        hasConversationError: true,
        hasValidationError: false,
        hasPickerError: false
      })
    ).toBe(false);
  });
});
