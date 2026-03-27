import { resolveMessageListVerticalAlignment } from './messageListLayout';

describe('MessageList helpers', () => {
  it('anchors non-empty conversations at the bottom', () => {
    expect(resolveMessageListVerticalAlignment(1)).toBe('bottom-anchored');
    expect(resolveMessageListVerticalAlignment(8)).toBe('bottom-anchored');
  });

  it('keeps empty state layout unchanged', () => {
    expect(resolveMessageListVerticalAlignment(0)).toBe('default');
  });
});
