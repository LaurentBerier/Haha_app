import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { PersistedStoreSnapshot } from '../models/Persistence';

const STORAGE_KEY = 'ha-ha-store-v1';
const LEGACY_SECURE_STORAGE_KEY = 'ha-ha-secure-v1';
const SECURE_CLEANUP_FLAG_KEY = 'ha-ha-secure-cleanup-v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isValidConversation(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.artistId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.language === 'string' &&
    typeof value.modeId === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.lastMessagePreview === 'string'
  );
}

function isValidConversationsMap(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(
    (entry) => Array.isArray(entry) && entry.every((conversation) => isValidConversation(conversation))
  );
}

function isValidMessageMetadata(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }

  const tokensUsedValid = value.tokensUsed === undefined || typeof value.tokensUsed === 'number';
  const voiceUrlValid = value.voiceUrl === undefined || typeof value.voiceUrl === 'string';
  const imageUriValid = value.imageUri === undefined || typeof value.imageUri === 'string';
  const imageMediaTypeValid = value.imageMediaType === undefined || typeof value.imageMediaType === 'string';
  return tokensUsedValid && voiceUrlValid && imageUriValid && imageMediaTypeValid;
}

function isValidMessage(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const roleValid = value.role === 'user' || value.role === 'artist';
  const statusValid =
    value.status === 'pending' ||
    value.status === 'streaming' ||
    value.status === 'complete' ||
    value.status === 'error';

  return (
    typeof value.id === 'string' &&
    typeof value.conversationId === 'string' &&
    roleValid &&
    typeof value.content === 'string' &&
    statusValid &&
    typeof value.timestamp === 'string' &&
    isValidMessageMetadata(value.metadata)
  );
}

function isValidMessagePage(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.messages) &&
    value.messages.every((message) => isValidMessage(message)) &&
    typeof value.hasMore === 'boolean' &&
    isStringOrNull(value.cursor)
  );
}

function isValidMessagesMap(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((entry) => isValidMessagePage(entry));
}

function isValidPreferences(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }

  const language = value.language;
  const displayMode = value.displayMode;
  const hasValidLanguage =
    language === undefined || language === 'fr-CA' || language === 'en-CA' || language === 'fr-FR' || language === 'en';
  const hasValidDisplayMode = displayMode === undefined || displayMode === 'dark' || displayMode === 'light' || displayMode === 'system';
  return hasValidLanguage && hasValidDisplayMode;
}

function isValidSnapshot(data: unknown): data is PersistedStoreSnapshot {
  if (!isRecord(data)) {
    return false;
  }

  return (
    isStringOrNull(data.selectedArtistId) &&
    isValidConversationsMap(data.conversations) &&
    isStringOrNull(data.activeConversationId) &&
    isValidMessagesMap(data.messagesByConversation) &&
    isValidPreferences(data.preferences)
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
