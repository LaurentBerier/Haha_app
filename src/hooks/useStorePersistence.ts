import { useEffect } from 'react';
import { loadPersistedSnapshot, savePersistedSnapshot } from '../services/persistenceService';
import { selectPersistedSnapshot, useStore } from '../store/useStore';

const SAVE_DEBOUNCE_MS = 500;

export function useStorePersistence(): void {
  const hydrateStore = useStore((state) => state.hydrateStore);
  const markHydrated = useStore((state) => state.markHydrated);
  const hasHydrated = useStore((state) => state.hasHydrated);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const snapshot = await loadPersistedSnapshot();
      if (!mounted) {
        return;
      }

      if (snapshot) {
        hydrateStore(snapshot);
      }

      markHydrated();
    })();

    return () => {
      mounted = false;
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
