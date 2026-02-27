import { useEffect } from 'react';
import { loadPersistedSnapshot, savePersistedSnapshot } from '../services/persistenceService';
import { selectPersistedSnapshot, useStore } from '../store/useStore';

const SAVE_DEBOUNCE_MS = 500;
const HYDRATION_TIMEOUT_MS = 4000;

export function useStorePersistence(): void {
  const hydrateStore = useStore((state) => state.hydrateStore);
  const markHydrated = useStore((state) => state.markHydrated);
  const hasHydrated = useStore((state) => state.hasHydrated);

  useEffect(() => {
    let mounted = true;
    let finished = false;

    const finalizeHydration = () => {
      if (!mounted || finished) {
        return;
      }
      finished = true;
      markHydrated();
    };

    const fallbackTimer = setTimeout(() => {
      if (__DEV__) {
        console.warn('[persistenceService] hydration timeout reached, continuing without snapshot');
      }
      finalizeHydration();
    }, HYDRATION_TIMEOUT_MS);

    (async () => {
      const snapshot = await loadPersistedSnapshot();
      if (!mounted || finished) {
        return;
      }

      if (snapshot) {
        hydrateStore(snapshot);
      }

      clearTimeout(fallbackTimer);
      finalizeHydration();
    })();

    return () => {
      mounted = false;
      clearTimeout(fallbackTimer);
    };
  }, [hydrateStore, markHydrated]);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = useStore.subscribe(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        const snapshot = selectPersistedSnapshot(useStore.getState());
        void savePersistedSnapshot(snapshot);
      }, SAVE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [hasHydrated]);
}
