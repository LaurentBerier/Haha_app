import { resolveChatBubbleImageDisplayVariant, resolveChatBubbleImageResizeMode } from './chatBubbleImageMode';

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
      resolveChatBubbleImageDisplayVariant({
        hasImage: false,
        memeType: 'final'
      })
    ).toBe('default');
  });

  it('resolves meme display variant for meme options and finals', () => {
    expect(
      resolveChatBubbleImageDisplayVariant({
        hasImage: true,
        memeType: 'option'
      })
    ).toBe('meme');
    expect(
      resolveChatBubbleImageDisplayVariant({
        hasImage: true,
        memeType: 'final'
      })
    ).toBe('meme');
  });

  it('resolves default variant for non-meme images', () => {
    expect(
      resolveChatBubbleImageDisplayVariant({
        hasImage: true,
        memeType: undefined
      })
    ).toBe('default');
  });
});
