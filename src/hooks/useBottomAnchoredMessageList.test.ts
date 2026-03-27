import { resolveBottomAnchoredListAutoScroll } from './useBottomAnchoredMessageList';

describe('useBottomAnchoredMessageList helpers', () => {
  it('does not auto-scroll before initial list layout is established', () => {
    const result = resolveBottomAnchoredListAutoScroll({
      hasScrolledInitially: false,
      shouldFollowTail: true,
      previousItemCount: 2,
      nextItemCount: 3
    });

    expect(result).toEqual({ shouldScroll: false, animated: false });
  });

  it('does not auto-scroll when tail-follow is disabled', () => {
    const result = resolveBottomAnchoredListAutoScroll({
      hasScrolledInitially: true,
      shouldFollowTail: false,
      previousItemCount: 2,
      nextItemCount: 3
    });

    expect(result).toEqual({ shouldScroll: false, animated: false });
  });

  it('auto-scrolls with animation when new items are appended', () => {
    const result = resolveBottomAnchoredListAutoScroll({
      hasScrolledInitially: true,
      shouldFollowTail: true,
      previousItemCount: 3,
      nextItemCount: 4
    });

    expect(result).toEqual({ shouldScroll: true, animated: true });
  });

  it('auto-scrolls without animation on non-growth updates', () => {
    const result = resolveBottomAnchoredListAutoScroll({
      hasScrolledInitially: true,
      shouldFollowTail: true,
      previousItemCount: 5,
      nextItemCount: 5
    });

    expect(result).toEqual({ shouldScroll: true, animated: false });
  });
});
