export interface ModeSelectTailFollowInput {
  distanceFromBottom: number;
  isUserGestureActive: boolean;
  shouldFollowTail: boolean;
  restoreDistancePx: number;
  breakDistancePx: number;
}

export interface ModeSelectTailFollowResolution {
  shouldFollowTail: boolean;
  isNearBottom: boolean;
  changed: boolean;
}

export function resolveModeSelectTailFollowState(
  input: ModeSelectTailFollowInput
): ModeSelectTailFollowResolution {
  let nextShouldFollowTail = input.shouldFollowTail;

  if (input.distanceFromBottom <= input.restoreDistancePx) {
    nextShouldFollowTail = true;
  } else if (input.isUserGestureActive && input.distanceFromBottom >= input.breakDistancePx) {
    nextShouldFollowTail = false;
  }

  const isNearBottom = input.distanceFromBottom <= input.restoreDistancePx;
  return {
    shouldFollowTail: nextShouldFollowTail,
    isNearBottom,
    changed: nextShouldFollowTail !== input.shouldFollowTail
  };
}
