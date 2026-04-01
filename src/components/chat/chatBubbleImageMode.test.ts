import { resolveChatBubbleImageResizeMode, shouldUseMemeImageStyle } from './chatBubbleImageMode';

describe('chatBubbleImageMode', () => {
  it('returns contain for meme option images', () => {
    expect(
      resolveChatBubbleImageResizeMode({
        hasImage: true,
        memeType: 'option'
      })
    ).toBe('contain');
  });

  it('returns contain for meme final images', () => {
    expect(
      resolveChatBubbleImageResizeMode({
        hasImage: true,
        memeType: 'final'
      })
    ).toBe('contain');
  });

  it('returns cover for non-meme images', () => {
    expect(
      resolveChatBubbleImageResizeMode({
        hasImage: true,
        memeType: undefined
      })
    ).toBe('cover');
  });

  it('keeps image behavior unchanged when there is no image', () => {
    expect(
      resolveChatBubbleImageResizeMode({
        hasImage: false,
        memeType: 'option'
      })
    ).toBeNull();
    expect(
      shouldUseMemeImageStyle({
        hasImage: false,
        memeType: 'final'
      })
    ).toBe(false);
  });
});
