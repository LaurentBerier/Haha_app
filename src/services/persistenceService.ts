import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersistedStoreSnapshot } from '../models/Persistence';

const STORAGE_KEY = 'ha-ha-store-v2';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isValidGreetingActivitySnapshot(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const numericKeys = ['punchlinesCreated', 'battleWins', 'memesGenerated', 'photosRoasted', 'roastsGenerated'] as const;
  const hasValidNumbers = numericKeys.every((key) => {
    const raw = value[key];
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0;
  });
  const hasValidCapturedAt = typeof value.capturedAt === 'string' && value.capturedAt.trim().length > 0;
  return hasValidNumbers && hasValidCapturedAt;
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
    (value.threadType === 'primary' || value.threadType === 'secondary' || value.threadType === 'mode') &&
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
  const voiceQueueValid =
    value.voiceQueue === undefined ||
    (Array.isArray(value.voiceQueue) && value.voiceQueue.every((entry) => typeof entry === 'string'));
  const voiceChunkBoundariesValid =
    value.voiceChunkBoundaries === undefined ||
    (Array.isArray(value.voiceChunkBoundaries) &&
      value.voiceChunkBoundaries.every((entry) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0));
  const voiceStatusValid =
    value.voiceStatus === undefined ||
    value.voiceStatus === 'generating' ||
    value.voiceStatus === 'ready' ||
    value.voiceStatus === 'unavailable';
  const voiceErrorCodeValid = value.voiceErrorCode === undefined || typeof value.voiceErrorCode === 'string';
  const cathyReactionValid = value.cathyReaction === undefined || typeof value.cathyReaction === 'string';
  const tutorialModeValid = value.tutorialMode === undefined || typeof value.tutorialMode === 'boolean';
  const injectedTypeValid =
    value.injectedType === undefined ||
    value.injectedType === 'greeting' ||
    value.injectedType === 'tutorial_greeting' ||
    value.injectedType === 'mode_nudge';
  const imageUriValid = value.imageUri === undefined || typeof value.imageUri === 'string';
  const imageMediaTypeValid = value.imageMediaType === undefined || typeof value.imageMediaType === 'string';
  const errorMessageValid = value.errorMessage === undefined || typeof value.errorMessage === 'string';
  const errorCodeValid = value.errorCode === undefined || typeof value.errorCode === 'string';
  const injectedValid = value.injected === undefined || typeof value.injected === 'boolean';
  const showUpgradeCtaValid = value.showUpgradeCta === undefined || typeof value.showUpgradeCta === 'boolean';
  const upgradeFromTierValid = value.upgradeFromTier === undefined || typeof value.upgradeFromTier === 'string';
  const greetingActivitySnapshotValid =
    value.greetingActivitySnapshot === undefined || isValidGreetingActivitySnapshot(value.greetingActivitySnapshot);
  const battleResultValid =
    value.battleResult === undefined ||
    value.battleResult === 'light' ||
    value.battleResult === 'solid' ||
    value.battleResult === 'destruction';
  const memeTypeValid =
    value.memeType === undefined ||
    value.memeType === 'upload_prompt' ||
    value.memeType === 'option' ||
    value.memeType === 'final';
  const memeDraftIdValid = value.memeDraftId === undefined || typeof value.memeDraftId === 'string';
  const memeOptionIdValid = value.memeOptionId === undefined || typeof value.memeOptionId === 'string';
  const memeOptionRankValid =
    value.memeOptionRank === undefined ||
    (typeof value.memeOptionRank === 'number' && Number.isFinite(value.memeOptionRank) && value.memeOptionRank > 0);
  const memeCaptionValid = value.memeCaption === undefined || typeof value.memeCaption === 'string';
  const memePlacementValid =
    value.memePlacement === undefined || value.memePlacement === 'top' || value.memePlacement === 'bottom';
  const memeLogoPlacementValid =
    value.memeLogoPlacement === undefined || value.memeLogoPlacement === 'left' || value.memeLogoPlacement === 'right';
  const memeSelectedValid = value.memeSelected === undefined || typeof value.memeSelected === 'boolean';
  return (
    tokensUsedValid &&
    voiceUrlValid &&
    voiceQueueValid &&
    voiceChunkBoundariesValid &&
    voiceStatusValid &&
    voiceErrorCodeValid &&
    cathyReactionValid &&
    tutorialModeValid &&
    injectedTypeValid &&
    imageUriValid &&
    imageMediaTypeValid &&
    errorMessageValid &&
    errorCodeValid &&
    injectedValid &&
    showUpgradeCtaValid &&
    upgradeFromTierValid &&
    greetingActivitySnapshotValid &&
    battleResultValid &&
    memeTypeValid &&
    memeDraftIdValid &&
    memeOptionIdValid &&
    memeOptionRankValid &&
    memeCaptionValid &&
    memePlacementValid &&
    memeLogoPlacementValid &&
    memeSelectedValid
  );
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
  const reduceMotion = value.reduceMotion;
  const voiceAutoPlay = value.voiceAutoPlay;
  const emojiStyle = value.emojiStyle;
  const conversationModeEnabled = value.conversationModeEnabled;
  const hasValidLanguage =
    language === undefined || language === 'fr-CA' || language === 'en-CA' || language === 'fr-FR' || language === 'en';
  const hasValidDisplayMode = displayMode === undefined || displayMode === 'dark' || displayMode === 'light' || displayMode === 'system';
  const hasValidReduceMotion =
    reduceMotion === undefined || reduceMotion === 'system' || reduceMotion === 'on' || reduceMotion === 'off';
  const hasValidVoiceAutoPlay = voiceAutoPlay === undefined || typeof voiceAutoPlay === 'boolean';
  const hasValidEmojiStyle =
    emojiStyle === undefined || emojiStyle === 'off' || emojiStyle === 'classic' || emojiStyle === 'full';
  const hasValidConversationModeEnabled =
    conversationModeEnabled === undefined || typeof conversationModeEnabled === 'boolean';
  const completedTutorials = value.completedTutorials;
  const hasValidCompletedTutorials =
    completedTutorials === undefined ||
    (isRecord(completedTutorials) &&
      Object.entries(completedTutorials).every(
        ([key, val]) => typeof key === 'string' && typeof val === 'boolean'
      ));
  return (
    hasValidLanguage &&
    hasValidDisplayMode &&
    hasValidReduceMotion &&
    hasValidVoiceAutoPlay &&
    hasValidEmojiStyle &&
    hasValidConversationModeEnabled &&
    hasValidCompletedTutorials
  );
}

function isValidGamification(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }

  const numericKeys = [
    'score',
    'roastsGenerated',
    'punchlinesCreated',
    'destructions',
    'photosRoasted',
    'memesGenerated',
    'battleWins',
    'dailyStreak',
    'jokesLanded',
    'cathySurprised',
    'cathyTriggered',
    'cathyIntrigued',
    'cathyApproved'
  ] as const;

  const hasValidNumbers = numericKeys.every((key) => {
    const raw = value[key];
    return raw === undefined || (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0);
  });

  const lastActiveDateValid = value.lastActiveDate === undefined || typeof value.lastActiveDate === 'string' || value.lastActiveDate === null;
  return hasValidNumbers && lastActiveDateValid;
}

function isValidSnapshot(data: unknown): data is PersistedStoreSnapshot {
  if (!isRecord(data)) {
    return false;
  }

  return (
    (data.ownerUserId === undefined || isStringOrNull(data.ownerUserId)) &&
    isStringOrNull(data.selectedArtistId) &&
    isValidConversationsMap(data.conversations) &&
    isStringOrNull(data.activeConversationId) &&
    isValidMessagesMap(data.messagesByConversation) &&
    isValidGamification(data.gamification) &&
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
