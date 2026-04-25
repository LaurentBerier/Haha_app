import { useEffect, useRef } from 'react';
import { subscribePageVisible, isPageVisibleNow } from './usePageVisible';

interface FocusRefetchOptions {
  /** Debounce window in ms — multiple hidden→visible transitions within this window only fire once. */
  debounceMs?: number;
  /** When false, the hook is inert. Useful to gate by feature flag or auth state. */
  enabled?: boolean;
  /** Run the callback once on mount (in addition to focus events). Defaults to true. */
  runOnMount?: boolean;
}

const DEFAULT_DEBOUNCE_MS = 2000;

/**
 * Fires `callback` only when the page transitions from hidden→visible (web) or
 * background→active (native). Skips firing while already visible/active.
 * Coalesces rapid transitions via a shared debounce window.
 *
 * Use this instead of subscribing to `focus`, `visibilitychange`, and `AppState`
 * directly — multiple hooks all listening separately fire redundant API calls.
 */
export function useFocusRefetch(callback: () => void, options: FocusRefetchOptions = {}): void {
  const { debounceMs = DEFAULT_DEBOUNCE_MS, enabled = true, runOnMount = true } = options;
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let lastFireAt = 0;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const fire = () => {
      pendingTimer = null;
      lastFireAt = Date.now();
      callbackRef.current();
    };

    const schedule = () => {
      if (pendingTimer !== null) {
        return;
      }
      const elapsed = Date.now() - lastFireAt;
      const wait = elapsed >= debounceMs ? 0 : debounceMs - elapsed;
      if (wait === 0) {
        fire();
      } else {
        pendingTimer = setTimeout(fire, wait);
      }
    };

    if (runOnMount) {
      lastFireAt = Date.now();
      callbackRef.current();
    }

    let wasVisible = isPageVisibleNow();
    const unsubscribe = subscribePageVisible((visible) => {
      if (visible && !wasVisible) {
        schedule();
      }
      wasVisible = visible;
    });

    return () => {
      unsubscribe();
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    };
  }, [debounceMs, enabled, runOnMount]);
}
