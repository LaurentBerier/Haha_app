import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { PersistedStoreSnapshot } from '../models/Persistence';

const STORAGE_KEY = 'ha-ha-store-v1';
const LEGACY_SECURE_STORAGE_KEY = 'ha-ha-secure-v1';
const SECURE_CLEANUP_FLAG_KEY = 'ha-ha-secure-cleanup-v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidSnapshot(data: unknown): data is PersistedStoreSnapshot {
  if (!isRecord(data)) {
    return false;
  }

  return (
    (typeof data.selectedArtistId === 'string' || data.selectedArtistId === null) &&
    isRecord(data.conversations) &&
    (typeof data.activeConversationId === 'string' || data.activeConversationId === null) &&
    isRecord(data.messagesByConversation)
  );
}

export async function loadPersistedSnapshot(): Promise<PersistedStoreSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (__DEV__) {
        console.warn('[persistenceService] invalid AsyncStorage JSON snapshot, discarding persisted data');
      }
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }

    if (isValidSnapshot(parsed)) {
      return parsed;
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
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    if (__DEV__) {
      console.warn('[persistenceService] save failed:', error);
    }
  }
}

export async function clearLegacySecureStoreData(): Promise<void> {
  try {
    const cleanupDone = await AsyncStorage.getItem(SECURE_CLEANUP_FLAG_KEY);
    if (cleanupDone === '1') {
      return;
    }

    await SecureStore.deleteItemAsync(LEGACY_SECURE_STORAGE_KEY);
    await AsyncStorage.setItem(SECURE_CLEANUP_FLAG_KEY, '1');
  } catch (error) {
    if (__DEV__) {
      console.warn('[persistenceService] legacy secure cleanup failed:', error);
    }
  }
}
