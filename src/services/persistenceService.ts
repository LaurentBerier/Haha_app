import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { PersistedStoreSnapshot, SecureStoreSnapshot } from '../models/Persistence';
import type { Subscription } from '../models/Subscription';

const STORAGE_KEY = 'ha-ha-store-v1';
const SECURE_STORAGE_KEY = 'ha-ha-secure-v1';

const DEFAULT_SUBSCRIPTION: Subscription = {
  tier: 'free',
  isActive: true,
  renewalDate: null
};
const DEFAULT_UNLOCKED_ARTIST_IDS: string[] = ['cathy-gauthier'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidBaseSnapshot(data: unknown): data is Omit<PersistedStoreSnapshot, 'subscription' | 'unlockedArtistIds'> {
  if (!isRecord(data)) {
    return false;
  }

  const quota = data.quota;
  if (!isRecord(quota)) {
    return false;
  }

  return (
    (typeof data.selectedArtistId === 'string' || data.selectedArtistId === null) &&
    isRecord(data.conversations) &&
    (typeof data.activeConversationId === 'string' || data.activeConversationId === null) &&
    isRecord(data.messagesByConversation) &&
    typeof quota.monthlyCap === 'number' &&
    typeof quota.used === 'number' &&
    typeof quota.resetDate === 'string'
  );
}

function parseSecureSnapshot(raw: string): Partial<SecureStoreSnapshot> | null {
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }

    const result: Partial<SecureStoreSnapshot> = {};
    if (isRecord(parsed.subscription)) {
      const tier = parsed.subscription.tier;
      const isActive = parsed.subscription.isActive;
      const renewalDate = parsed.subscription.renewalDate;
      if (
        (tier === 'free' || tier === 'core' || tier === 'pro') &&
        typeof isActive === 'boolean' &&
        (typeof renewalDate === 'string' || renewalDate === null)
      ) {
        result.subscription = {
          tier,
          isActive,
          renewalDate
        };
      }
    }

    if (Array.isArray(parsed.unlockedArtistIds) && parsed.unlockedArtistIds.every((id) => typeof id === 'string')) {
      result.unlockedArtistIds = parsed.unlockedArtistIds;
    }

    return result;
  } catch {
    return null;
  }
}

export async function loadPersistedSnapshot(): Promise<PersistedStoreSnapshot | null> {
  try {
    const [asyncResult, secureResult] = await Promise.allSettled([
      AsyncStorage.getItem(STORAGE_KEY),
      SecureStore.getItemAsync(SECURE_STORAGE_KEY)
    ]);

    const raw = asyncResult.status === 'fulfilled' ? asyncResult.value : null;
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (isValidBaseSnapshot(parsed)) {
      const hydrated: PersistedStoreSnapshot = {
        ...parsed,
        subscription: DEFAULT_SUBSCRIPTION,
        unlockedArtistIds: DEFAULT_UNLOCKED_ARTIST_IDS
      };

      if (secureResult.status === 'fulfilled' && secureResult.value) {
        const secure = parseSecureSnapshot(secureResult.value);
        if (secure?.subscription) {
          hydrated.subscription = secure.subscription;
        }
        if (secure?.unlockedArtistIds) {
          hydrated.unlockedArtistIds = secure.unlockedArtistIds;
        }
      } else if (secureResult.status === 'rejected') {
        if (__DEV__) {
          console.warn('[persistenceService] SecureStore load failed, using defaults:', secureResult.reason);
        }
      }

      return hydrated;
    }

    return null;
  } catch (error) {
    if (__DEV__) {
      console.warn('[persistenceService] load failed:', error);
    }
    return null;
  }
}

export async function savePersistedSnapshot(snapshot: PersistedStoreSnapshot): Promise<void> {
  try {
    const { subscription, unlockedArtistIds, ...rest } = snapshot;
    const secureSnapshot: SecureStoreSnapshot = {
      subscription,
      unlockedArtistIds
    };

    const [asyncResult, secureResult] = await Promise.allSettled([
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(rest)),
      SecureStore.setItemAsync(SECURE_STORAGE_KEY, JSON.stringify(secureSnapshot))
    ]);

    if (__DEV__) {
      if (asyncResult.status === 'rejected') {
        console.warn('[persistenceService] AsyncStorage save failed:', asyncResult.reason);
      }
      if (secureResult.status === 'rejected') {
        console.warn('[persistenceService] SecureStore save failed:', secureResult.reason);
      }
    }
  } catch (error) {
    if (__DEV__) {
      console.warn('[persistenceService] save failed (unexpected):', error);
    }
    // Write failures are non-fatal. The app continues with in-memory state.
  }
}
