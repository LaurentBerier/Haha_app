import { resolveModeSelectTailFollowState } from './modeSelectTailFollow';

describe('modeSelectTailFollow', () => {
  const restoreDistancePx = 96;
  const breakDistancePx = 220;

  it('keeps following tail near bottom', () => {
    const result = resolveModeSelectTailFollowState({
      distanceFromBottom: 40,
      isUserGestureActive: false,
      shouldFollowTail: false,
      restoreDistancePx,
      breakDistancePx
    });

    expect(result).toEqual({
      shouldFollowTail: true,
      isNearBottom: true,
      changed: true
    });
  });

  it('breaks tail follow only when user gesture is active and distance is large', () => {
    const result = resolveModeSelectTailFollowState({
      distanceFromBottom: 280,
      isUserGestureActive: true,
      shouldFollowTail: true,
      restoreDistancePx,
      breakDistancePx
    });

    expect(result).toEqual({
      shouldFollowTail: false,
      isNearBottom: false,
      changed: true
    });
  });

  it('does not break tail follow from programmatic scroll/layout changes alone', () => {
    const result = resolveModeSelectTailFollowState({
      distanceFromBottom: 280,
      isUserGestureActive: false,
      shouldFollowTail: true,
      restoreDistancePx,
      breakDistancePx
    });

    expect(result).toEqual({
      shouldFollowTail: true,
      isNearBottom: false,
      changed: false
    });
  });
});
