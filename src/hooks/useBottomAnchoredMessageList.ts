import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { FlatList, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { resolveModeSelectTailFollowState } from '../utils/modeSelectTailFollow';

const DEFAULT_RESTORE_DISTANCE_PX = 96;
const DEFAULT_BREAK_DISTANCE_PX = 220;

export interface TailFollowChangedPayload {
  shouldFollowTail: boolean;
  distanceFromBottom: number;
}

export interface BottomAnchoredListAutoScrollInput {
  hasScrolledInitially: boolean;
  shouldFollowTail: boolean;
  previousItemCount: number;
  nextItemCount: number;
}

export interface BottomAnchoredListAutoScrollResolution {
  shouldScroll: boolean;
  animated: boolean;
}

export function resolveBottomAnchoredListAutoScroll(
  input: BottomAnchoredListAutoScrollInput
): BottomAnchoredListAutoScrollResolution {
  if (!input.hasScrolledInitially || !input.shouldFollowTail) {
    return { shouldScroll: false, animated: false };
  }

  return {
    shouldScroll: true,
    animated: input.nextItemCount > input.previousItemCount
  };
}

interface UseBottomAnchoredMessageListOptions {
  itemCount: number;
  resetKey?: string | number;
  forceFollowSignal?: number;
  restoreDistancePx?: number;
  breakDistancePx?: number;
  onTailFollowChanged?: (payload: TailFollowChangedPayload) => void;
}

interface UseBottomAnchoredMessageListResult<T> {
  listRef: MutableRefObject<FlatList<T> | null>;
  requestFollowTail: (animated?: boolean) => void;
  onContentSizeChange: () => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollBeginDrag: () => void;
  onScrollEndDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onMomentumScrollBegin: () => void;
  onMomentumScrollEnd: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

function scheduleFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
    return;
  }

  setTimeout(callback, 0);
}

export function useBottomAnchoredMessageList<T>({
  itemCount,
  resetKey,
  forceFollowSignal,
  restoreDistancePx = DEFAULT_RESTORE_DISTANCE_PX,
  breakDistancePx = DEFAULT_BREAK_DISTANCE_PX,
  onTailFollowChanged
}: UseBottomAnchoredMessageListOptions): UseBottomAnchoredMessageListResult<T> {
  const listRef = useRef<FlatList<T> | null>(null);
  const isNearBottomRef = useRef(true);
  const shouldFollowTailRef = useRef(true);
  const isDragActiveRef = useRef(false);
  const isMomentumActiveRef = useRef(false);
  const hasScrolledInitiallyRef = useRef(false);
  const lastItemCountRef = useRef(0);
  const lastForceFollowSignalRef = useRef<number | undefined>(undefined);

  const scrollToLatest = useCallback((animated: boolean) => {
    scheduleFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const syncTailFollowFromDistance = useCallback(
    (distanceFromBottom: number) => {
      const isUserGestureActive = isDragActiveRef.current || isMomentumActiveRef.current;
      const resolution = resolveModeSelectTailFollowState({
        distanceFromBottom,
        isUserGestureActive,
        shouldFollowTail: shouldFollowTailRef.current,
        restoreDistancePx,
        breakDistancePx
      });

      shouldFollowTailRef.current = resolution.shouldFollowTail;
      isNearBottomRef.current = resolution.isNearBottom;

      if (resolution.changed) {
        onTailFollowChanged?.({
          shouldFollowTail: resolution.shouldFollowTail,
          distanceFromBottom
        });
      }
    },
    [breakDistancePx, onTailFollowChanged, restoreDistancePx]
  );

  const resetTailFollowState = useCallback(() => {
    isNearBottomRef.current = true;
    shouldFollowTailRef.current = true;
    isDragActiveRef.current = false;
    isMomentumActiveRef.current = false;
    hasScrolledInitiallyRef.current = false;
    lastItemCountRef.current = 0;
    lastForceFollowSignalRef.current = undefined;
  }, []);

  const requestFollowTail = useCallback(
    (animated = true) => {
      shouldFollowTailRef.current = true;
      isNearBottomRef.current = true;
      if (hasScrolledInitiallyRef.current) {
        scrollToLatest(animated);
      }
    },
    [scrollToLatest]
  );

  const onContentSizeChange = useCallback(() => {
    if (!hasScrolledInitiallyRef.current) {
      hasScrolledInitiallyRef.current = true;
      shouldFollowTailRef.current = true;
      scrollToLatest(false);
      return;
    }

    if (shouldFollowTailRef.current) {
      scrollToLatest(true);
    }
  }, [scrollToLatest]);

  const onScroll = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = nativeEvent.contentOffset?.y ?? 0;
      const contentHeight = nativeEvent.contentSize?.height ?? 0;
      const layoutHeight = nativeEvent.layoutMeasurement?.height ?? 0;
      const distanceFromBottom = contentHeight - (offsetY + layoutHeight);
      syncTailFollowFromDistance(distanceFromBottom);
    },
    [syncTailFollowFromDistance]
  );

  const onScrollBeginDrag = useCallback(() => {
    isDragActiveRef.current = true;
  }, []);

  const onScrollEndDrag = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      isDragActiveRef.current = false;
      const offsetY = nativeEvent.contentOffset?.y ?? 0;
      const contentHeight = nativeEvent.contentSize?.height ?? 0;
      const layoutHeight = nativeEvent.layoutMeasurement?.height ?? 0;
      const distanceFromBottom = contentHeight - (offsetY + layoutHeight);
      syncTailFollowFromDistance(distanceFromBottom);
    },
    [syncTailFollowFromDistance]
  );

  const onMomentumScrollBegin = useCallback(() => {
    isMomentumActiveRef.current = true;
  }, []);

  const onMomentumScrollEnd = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    isMomentumActiveRef.current = false;
      const offsetY = nativeEvent.contentOffset?.y ?? 0;
      const contentHeight = nativeEvent.contentSize?.height ?? 0;
      const layoutHeight = nativeEvent.layoutMeasurement?.height ?? 0;
      const distanceFromBottom = contentHeight - (offsetY + layoutHeight);
      syncTailFollowFromDistance(distanceFromBottom);
    },
    [syncTailFollowFromDistance]
  );

  useEffect(() => {
    const previousCount = lastItemCountRef.current;
    lastItemCountRef.current = itemCount;

    const resolution = resolveBottomAnchoredListAutoScroll({
      hasScrolledInitially: hasScrolledInitiallyRef.current,
      shouldFollowTail: shouldFollowTailRef.current,
      previousItemCount: previousCount,
      nextItemCount: itemCount
    });

    if (resolution.shouldScroll) {
      scrollToLatest(resolution.animated);
    }
  }, [itemCount, scrollToLatest]);

  useEffect(() => {
    if (forceFollowSignal === undefined) {
      return;
    }

    if (lastForceFollowSignalRef.current === undefined) {
      lastForceFollowSignalRef.current = forceFollowSignal;
      return;
    }

    if (lastForceFollowSignalRef.current === forceFollowSignal) {
      return;
    }

    lastForceFollowSignalRef.current = forceFollowSignal;
    requestFollowTail(true);
  }, [forceFollowSignal, requestFollowTail]);

  useEffect(() => {
    resetTailFollowState();
  }, [resetKey, resetTailFollowState]);

  return {
    listRef,
    requestFollowTail,
    onContentSizeChange,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd
  };
}
