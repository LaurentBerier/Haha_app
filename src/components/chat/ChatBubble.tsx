import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ARTIST_IDS } from '../../config/constants';
import { t } from '../../i18n';
import type { Message } from '../../models/Message';
import { fetchAndCacheVoice } from '../../services/ttsService';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';
import { hasVoiceAccessForAccountType } from '../../utils/accountTypeUtils';
import { stripAudioTags } from '../../utils/audioTags';
import { findConversationById } from '../../utils/conversationUtils';
import type { AudioPlayerController } from '../../hooks/useAudioPlayer';
import {
  resolveChatBubbleVoiceControlState,
  resolveVoiceUnavailableTranslationKey
} from './chatBubbleVoiceState';
import { resolveChatBubbleImageDisplayVariant, resolveChatBubbleImageResizeMode } from './chatBubbleImageMode';
import { shouldDowngradeVoiceAfterPlaybackFailure } from './chatBubbleVoicePlayback';
import { WaveformButton } from './WaveformButton';

interface ChatBubbleProps {
  message: Message;
  userDisplayName: string;
  artistDisplayName: string;
  onRetryMessage?: (messageId: string) => void;
  onRetryVoice?: (messageId: string) => Promise<void> | void;
  onChooseMemeOption?: (messageId: string) => Promise<void> | void;
  onSaveMeme?: (messageId: string) => Promise<void> | void;
  onShareMeme?: (messageId: string) => Promise<void> | void;
  activeMemeOptionId?: string | null;
  activeMemeSaveMessageId?: string | null;
  activeMemeShareMessageId?: string | null;
  audioPlayer?: AudioPlayerController;
}

const USE_NATIVE_DRIVER = Platform.OS !== 'web';

function resolveVoiceErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const explicitCode = 'code' in error && typeof error.code === 'string' ? error.code.trim() : '';
    if (explicitCode) {
      return explicitCode;
    }
    const status = 'status' in error && typeof error.status === 'number' ? error.status : null;
    if (status === 429) {
      return 'RATE_LIMIT_EXCEEDED';
    }
    if (status === 403) {
      return 'TTS_FORBIDDEN';
    }
    if (status === 401) {
      return 'UNAUTHORIZED';
    }
  }

  return 'TTS_PROVIDER_ERROR';
}

function logVoiceFailure(context: string, details: Record<string, unknown>): void {
  if (!__DEV__) {
    return;
  }

  console.warn('[ChatBubble][voice]', {
    context,
    ...details
  });
}

function ChatBubbleBase({
  message,
  userDisplayName,
  artistDisplayName,
  onRetryMessage,
  onRetryVoice,
  onChooseMemeOption,
  onSaveMeme,
  onShareMeme,
  activeMemeOptionId,
  activeMemeSaveMessageId,
  activeMemeShareMessageId,
  audioPlayer
}: ChatBubbleProps) {
  const router = useRouter();
  const updateMessage = useStore((state) => state.updateMessage);
  const accessToken = useStore((state) => state.session?.accessToken ?? '');
  const accountType = useStore((state) => state.session?.user.accountType ?? null);
  const conversation = useStore((state) => findConversationById(state.conversations, message.conversationId));
  const enterOpacity = useRef(new Animated.Value(0)).current;
  const enterTranslateY = useRef(new Animated.Value(6)).current;
  const memeSelectScale = useRef(new Animated.Value(1)).current;
  const wasMemeOptionSelectedRef = useRef(false);
  const didInitMemeSelectionRef = useRef(false);
  const [isVoiceRetryInFlight, setIsVoiceRetryInFlight] = useState(false);
  const prevAccessTokenRef = useRef('');
  const isUser = message.role === 'user';
  const imageUri = message.metadata?.imageUri;
  const errorMessage =
    typeof message.metadata?.errorMessage === 'string' && message.metadata.errorMessage.trim()
      ? message.metadata.errorMessage.trim()
      : t('errorStreaming');
  const safeMessageContent = stripAudioTags(message.content);
  const hasText = safeMessageContent.trim().length > 0;
  const shouldShowPlaceholder = !hasText && !imageUri;
  const isMemeOption = message.metadata?.memeType === 'option';
  const isMemeFinal = message.metadata?.memeType === 'final' && Boolean(imageUri);
  const hasMemeMetadata = typeof message.metadata?.memeType === 'string';
  const imageResizeMode = resolveChatBubbleImageResizeMode({
    hasImage: Boolean(imageUri),
    memeType: message.metadata?.memeType
  });
  const imageDisplayVariant = resolveChatBubbleImageDisplayVariant({
    hasImage: Boolean(imageUri),
    memeType: message.metadata?.memeType
  });
  const isMemeOptionSelected = Boolean(message.metadata?.memeSelected);
  const isAnyMemeOptionBusy = Boolean(activeMemeOptionId);
  const isChoosingMemeOption = activeMemeOptionId === message.id;
  const isSavingMeme = activeMemeSaveMessageId === message.id;
  const isSharingMeme = activeMemeShareMessageId === message.id;
  const senderName = isUser ? userDisplayName : artistDisplayName;
  const battleResult = message.metadata?.battleResult;
  const battleBadgeLabel =
    battleResult === 'destruction'
      ? '💀 Destruction'
      : battleResult === 'solid'
        ? '🎤 Solide'
        : battleResult === 'light'
          ? '🔥 Léger'
          : null;
  const voiceUrl = typeof message.metadata?.voiceUrl === 'string' ? message.metadata.voiceUrl : '';
  const voiceQueue = Array.isArray(message.metadata?.voiceQueue) ? message.metadata.voiceQueue : [];
  const voiceChunkBoundaries = Array.isArray(message.metadata?.voiceChunkBoundaries)
    ? message.metadata.voiceChunkBoundaries
    : [];
  const voiceStatus = message.metadata?.voiceStatus;
  const isVoiceEligible =
    message.role === 'artist' &&
    message.status === 'complete' &&
    hasText &&
    !hasMemeMetadata &&
    conversation?.artistId === ARTIST_IDS.CATHY_GAUTHIER &&
    hasVoiceAccessForAccountType(accountType);
  const voiceControlState = resolveChatBubbleVoiceControlState({
    isEligible: isVoiceEligible,
    voiceUrl,
    voiceStatus
  });
  const hasVoiceButton = voiceControlState === 'ready';
  const isVoiceGenerating = voiceControlState === 'generating' || isVoiceRetryInFlight;
  const isVoiceUnavailable = voiceControlState === 'unavailable' && !isVoiceRetryInFlight;
  const voiceUnavailableMessageKey = resolveVoiceUnavailableTranslationKey(message.metadata?.voiceErrorCode);
  const isCurrentVoiceMessage = Boolean(audioPlayer && audioPlayer.currentMessageId === message.id);
  const isVoicePlaying = Boolean(audioPlayer && audioPlayer.isPlaying && isCurrentVoiceMessage);
  const hasSeenInitialSyncedPlaybackRef = useRef(false);
  const hasCompletedInitialSyncedPlaybackRef = useRef(false);

  useEffect(() => {
    if (!audioPlayer || voiceChunkBoundaries.length === 0 || !voiceUrl) {
      return;
    }

    if (isCurrentVoiceMessage && isVoicePlaying) {
      hasSeenInitialSyncedPlaybackRef.current = true;
      return;
    }

    if (
      hasSeenInitialSyncedPlaybackRef.current &&
      !audioPlayer.isPlaying &&
      !audioPlayer.isLoading &&
      !isCurrentVoiceMessage
    ) {
      hasCompletedInitialSyncedPlaybackRef.current = true;
    }
  }, [
    audioPlayer,
    isCurrentVoiceMessage,
    isVoicePlaying,
    voiceChunkBoundaries.length,
    voiceUrl
  ]);

  const isSyncActive = Boolean(
    audioPlayer &&
      isCurrentVoiceMessage &&
      isVoicePlaying &&
      Array.isArray(voiceChunkBoundaries) &&
      voiceChunkBoundaries.length > 0 &&
      !hasCompletedInitialSyncedPlaybackRef.current
  );
  const activeChunkIndex = audioPlayer?.currentIndex ?? -1;
  const currentBoundary = isSyncActive
    ? voiceChunkBoundaries[activeChunkIndex] ?? safeMessageContent.length
    : safeMessageContent.length;
  const clampedBoundary = Math.max(0, Math.min(currentBoundary, safeMessageContent.length));
  const shouldApplyBoundarySync = isSyncActive && clampedBoundary > 0;
  const visibleContent = shouldApplyBoundarySync ? safeMessageContent.slice(0, clampedBoundary) : safeMessageContent;
  const displayedText = hasText ? visibleContent : '...';
  const showVoiceControl = voiceControlState !== 'hidden';
  const isQuotaError =
    message.metadata?.errorCode === 'QUOTA_EXCEEDED_BLOCKED' ||
    message.metadata?.errorCode === 'QUOTA_ABSOLUTE_BLOCKED' ||
    message.metadata?.errorCode === 'MONTHLY_QUOTA_EXCEEDED';
  const mergeMetadata = useCallback(
    (patch: NonNullable<Message['metadata']>) => {
      const latestMessage =
        useStore
          .getState()
          .messagesByConversation[message.conversationId]
          ?.messages.find((candidate) => candidate.id === message.id) ?? null;
      const latestMetadata = latestMessage?.metadata ?? {};
      updateMessage(message.conversationId, message.id, {
        metadata: {
          ...latestMetadata,
          ...patch
        }
      });
    },
    [message.conversationId, message.id, updateMessage]
  );

  const retryVoiceLocally = useCallback(async () => {
    if (!conversation || !safeMessageContent.trim() || !accessToken.trim()) {
      mergeMetadata({
        voiceStatus: 'unavailable',
        voiceErrorCode: 'UNAUTHORIZED',
        voiceUrl: undefined,
        voiceQueue: undefined,
        voiceChunkBoundaries: undefined
      });
      return;
    }

    mergeMetadata({
      voiceStatus: 'generating',
      voiceErrorCode: undefined,
      voiceUrl: undefined,
      voiceQueue: undefined,
      voiceChunkBoundaries: undefined
    });

    try {
      const uri = await fetchAndCacheVoice(
        safeMessageContent,
        conversation.artistId,
        conversation.language || 'fr-CA',
        accessToken,
        { throwOnError: true }
      );

      if (uri) {
        mergeMetadata({
          voiceStatus: 'ready',
          voiceErrorCode: undefined,
          voiceUrl: uri,
          voiceQueue: [uri],
          voiceChunkBoundaries: [stripAudioTags(safeMessageContent, { trim: true }).length]
        });
        return;
      }

      logVoiceFailure('retry_returned_empty_uri', {
        messageId: message.id,
        conversationId: message.conversationId
      });
      mergeMetadata({
        voiceStatus: 'unavailable',
        voiceErrorCode: 'TTS_PROVIDER_ERROR',
        voiceUrl: undefined,
        voiceQueue: undefined,
        voiceChunkBoundaries: undefined
      });
    } catch (error: unknown) {
      logVoiceFailure('retry_failed', {
        messageId: message.id,
        conversationId: message.conversationId,
        status: typeof error === 'object' && error && 'status' in error ? (error as { status?: unknown }).status : undefined,
        code: typeof error === 'object' && error && 'code' in error ? (error as { code?: unknown }).code : undefined
      });
      mergeMetadata({
        voiceStatus: 'unavailable',
        voiceErrorCode: resolveVoiceErrorCode(error),
        voiceUrl: undefined,
        voiceQueue: undefined,
        voiceChunkBoundaries: undefined
      });
    }
  }, [accessToken, conversation, mergeMetadata, safeMessageContent]);

  const handleRetryVoice = useCallback(() => {
    if (isVoiceRetryInFlight) {
      return;
    }
    setIsVoiceRetryInFlight(true);
    const retryTask = onRetryVoice ? Promise.resolve(onRetryVoice(message.id)) : retryVoiceLocally();
    void retryTask.finally(() => {
      setIsVoiceRetryInFlight(false);
    });
  }, [isVoiceRetryInFlight, message.id, onRetryVoice, retryVoiceLocally]);

  useEffect(() => {
    const prevToken = prevAccessTokenRef.current;
    prevAccessTokenRef.current = accessToken;

    if (
      prevToken === accessToken ||
      !accessToken.trim() ||
      message.metadata?.voiceStatus !== 'unavailable' ||
      message.metadata?.voiceErrorCode !== 'UNAUTHORIZED' ||
      isVoiceRetryInFlight
    ) {
      return;
    }

    handleRetryVoice();
  }, [
    accessToken,
    handleRetryVoice,
    isVoiceRetryInFlight,
    message.id,
    message.metadata?.voiceErrorCode,
    message.metadata?.voiceStatus
  ]);

  const handleVoicePress = () => {
    if (!audioPlayer || !hasVoiceButton) {
      return;
    }

    if (isVoicePlaying) {
      void audioPlayer.pause();
      return;
    }

    const uris = voiceQueue.length > 0 ? voiceQueue : [voiceUrl];
    void (async () => {
      const result = await audioPlayer.playQueue(uris, { messageId: message.id });
      if (result.started) {
        return;
      }

      if (shouldDowngradeVoiceAfterPlaybackFailure(result.reason)) {
        logVoiceFailure('replay_failed_invalid_uri', {
          reason: result.reason,
          messageId: message.id,
          uriCount: uris.length
        });
        mergeMetadata({
          voiceStatus: 'unavailable',
          voiceErrorCode: 'TTS_PROVIDER_ERROR',
          voiceUrl: undefined,
          voiceQueue: undefined,
          voiceChunkBoundaries: undefined
        });
      }
    })();
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(enterOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: USE_NATIVE_DRIVER
      }),
      Animated.timing(enterTranslateY, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: USE_NATIVE_DRIVER
      })
    ]).start();
  }, [enterOpacity, enterTranslateY]);

  useEffect(() => {
    if (!didInitMemeSelectionRef.current) {
      didInitMemeSelectionRef.current = true;
      wasMemeOptionSelectedRef.current = isMemeOptionSelected;
      return;
    }

    const wasSelected = wasMemeOptionSelectedRef.current;
    wasMemeOptionSelectedRef.current = isMemeOptionSelected;

    if (!isMemeOptionSelected || wasSelected) {
      return;
    }

    memeSelectScale.setValue(1);
    Animated.sequence([
      Animated.timing(memeSelectScale, {
        toValue: 1.04,
        duration: 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: USE_NATIVE_DRIVER
      }),
      Animated.timing(memeSelectScale, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: USE_NATIVE_DRIVER
      })
    ]).start();
  }, [isMemeOptionSelected, memeSelectScale]);

  return (
    <Animated.View
      style={[
        styles.row,
        isUser ? styles.userRow : styles.artistRow,
        { opacity: enterOpacity, transform: [{ translateY: enterTranslateY }] }
      ]}
    >
      <View style={[styles.block, isUser ? styles.userBlock : styles.artistBlock]}>
        <Text
          style={[styles.senderName, isUser ? styles.userSenderName : styles.artistSenderName]}
          numberOfLines={1}
          testID={`chat-bubble-sender-${message.id}`}
        >
          {senderName}
        </Text>
        <Animated.View
          style={[
            styles.bubble,
            isUser ? styles.userBubble : styles.artistBubble,
            isMemeOptionSelected ? styles.memeOptionBubbleSelected : null,
            { transform: [{ scale: memeSelectScale }] }
          ]}
          testID={`chat-bubble-${message.role}-${message.id}`}
          accessibilityLabel={`chat-bubble-${message.role}`}
        >
          {imageUri ? (
            <Image
              source={{ uri: imageUri }}
              style={[styles.image, imageDisplayVariant === 'meme' ? styles.memeImage : null]}
              resizeMode={imageResizeMode ?? 'cover'}
            />
          ) : null}

          {isMemeOption && typeof message.metadata?.memeOptionRank === 'number' ? (
            <View style={styles.memeOptionTagRow}>
              <Text style={styles.memeOptionTag}>{`${t('memeOptionLabel')} ${message.metadata.memeOptionRank}`}</Text>
              {isMemeOptionSelected ? <Text style={styles.memeOptionSelectedTag}>{t('memeOptionChosen')}</Text> : null}
            </View>
          ) : null}

          {hasText || shouldShowPlaceholder ? (
            <Text style={styles.content} testID={`chat-bubble-content-${message.id}`}>
              {displayedText}
            </Text>
          ) : null}

          {battleBadgeLabel ? (
            <View style={styles.battleBadge} testID={`chat-bubble-battle-${message.id}`}>
              <Text style={styles.battleBadgeLabel}>{battleBadgeLabel}</Text>
            </View>
          ) : null}

          {message.metadata?.showUpgradeCta ? (
            <Pressable
              onPress={() => router.push('/settings/subscription')}
              style={styles.upgradeButton}
              testID={`chat-bubble-upgrade-${message.id}`}
            >
              <Text style={styles.upgradeLabel}>{t('upgradeCtaLabel')}</Text>
            </Pressable>
          ) : null}

          {isMemeOption && onChooseMemeOption ? (
            <Pressable
              onPress={() => {
                void onChooseMemeOption(message.id);
              }}
              style={[styles.memePrimaryAction, (isAnyMemeOptionBusy || isMemeOptionSelected) && styles.disabledButton]}
              disabled={isAnyMemeOptionBusy || isMemeOptionSelected}
              testID={`chat-bubble-meme-choose-${message.id}`}
            >
              <Text style={styles.memePrimaryActionLabel}>
                {isChoosingMemeOption
                  ? t('memeFinalizeLoading')
                  : isMemeOptionSelected
                    ? t('memeOptionChosen')
                    : t('memeChooseOption')}
              </Text>
            </Pressable>
          ) : null}

          {isMemeFinal ? (
            <View style={styles.memeActionsRow}>
              <Pressable
                onPress={() => {
                  if (!onSaveMeme) {
                    return;
                  }
                  void onSaveMeme(message.id);
                }}
                style={[styles.memeSecondaryAction, (isSavingMeme || isSharingMeme || !onSaveMeme) && styles.disabledButton]}
                disabled={isSavingMeme || isSharingMeme || !onSaveMeme}
                testID={`chat-bubble-meme-save-${message.id}`}
              >
                <Text style={styles.memeSecondaryActionLabel}>
                  {isSavingMeme ? t('thinking') : t('memeSaveAction')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!onShareMeme) {
                    return;
                  }
                  void onShareMeme(message.id);
                }}
                style={[styles.memeSecondaryAction, (isSavingMeme || isSharingMeme || !onShareMeme) && styles.disabledButton]}
                disabled={isSavingMeme || isSharingMeme || !onShareMeme}
                testID={`chat-bubble-meme-share-${message.id}`}
              >
                <Text style={styles.memeSecondaryActionLabel}>
                  {isSharingMeme ? t('thinking') : t('memeShareAction')}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {showVoiceControl ? (
            <View style={styles.voiceRow}>
              <WaveformButton
                isPlaying={isVoicePlaying}
                isLoading={isVoiceGenerating}
                onPress={handleVoicePress}
                disabled={!hasVoiceButton}
                testID={
                  isVoiceGenerating
                    ? `chat-bubble-voice-loading-${message.id}`
                    : isVoiceUnavailable
                      ? `chat-bubble-voice-unavailable-${message.id}`
                      : `chat-bubble-voice-${message.id}`
                }
              />
              {isVoiceUnavailable ? (
                <>
                  <Text style={styles.voiceUnavailableText} testID={`chat-bubble-voice-unavailable-reason-${message.id}`}>
                    {t(voiceUnavailableMessageKey)}
                  </Text>
                  <Pressable
                    onPress={handleRetryVoice}
                    style={styles.voiceRetryButton}
                    testID={`chat-bubble-voice-retry-${message.id}`}
                  >
                    <Text style={styles.voiceRetryLabel}>{t('voiceRetryLabel')}</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}

          {message.status === 'error' ? (
            <>
              <Text style={styles.error} testID={`chat-bubble-error-${message.id}`}>
                {errorMessage}
              </Text>
              {onRetryMessage && !isQuotaError ? (
                <Pressable
                  onPress={() => onRetryMessage(message.id)}
                  style={styles.retryButton}
                  testID={`chat-bubble-retry-${message.id}`}
                >
                  <Text style={styles.retryLabel}>{t('retry')}</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}

          {isUser && typeof message.metadata?.cathyReaction === 'string' && message.metadata.cathyReaction.trim() ? (
            <View style={styles.reactionBadge} testID={`chat-bubble-reaction-${message.id}`}>
              <Text style={styles.reactionEmoji}>{message.metadata.cathyReaction}</Text>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

export const ChatBubble = memo(ChatBubbleBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.sm,
    marginVertical: theme.spacing.xs
  },
  userRow: {
    justifyContent: 'flex-end'
  },
  artistRow: {
    justifyContent: 'flex-start'
  },
  block: {
    maxWidth: '82%'
  },
  userBlock: {
    alignItems: 'flex-end'
  },
  artistBlock: {
    alignItems: 'flex-start'
  },
  senderName: {
    color: theme.colors.textDisabled,
    fontSize: 11,
    marginBottom: 4
  },
  userSenderName: {
    textAlign: 'right'
  },
  artistSenderName: {
    textAlign: 'left'
  },
  bubble: {
    maxWidth: '100%',
    borderRadius: 16,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    minHeight: 40
  },
  userBubble: {
    backgroundColor: theme.colors.userBubble
  },
  artistBubble: {
    backgroundColor: theme.colors.artistBubble,
    borderWidth: 1,
    borderColor: theme.colors.border
  },
  image: {
    width: 220,
    height: 220,
    maxWidth: '100%',
    borderRadius: 12,
    marginBottom: theme.spacing.xs,
    backgroundColor: theme.colors.surfaceSunken
  },
  memeImage: {
    width: 260,
    height: 390,
    maxWidth: '100%',
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: theme.colors.border
  },
  content: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19
  },
  memeOptionTag: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6
  },
  memeOptionTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.xs
  },
  memeOptionSelectedTag: {
    marginBottom: 6,
    color: theme.colors.neonBlue,
    borderWidth: 1,
    borderColor: theme.colors.neonBlue,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '700'
  },
  memePrimaryAction: {
    marginTop: theme.spacing.xs,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.neonBlue,
    borderRadius: 8,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    backgroundColor: theme.colors.surfaceRaised
  },
  memePrimaryActionLabel: {
    color: theme.colors.neonBlue,
    fontSize: 12,
    fontWeight: '700'
  },
  memeActionsRow: {
    marginTop: theme.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs
  },
  memeSecondaryAction: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    backgroundColor: theme.colors.surfaceRaised
  },
  memeSecondaryActionLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700'
  },
  memeOptionBubbleSelected: {
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceRaised
  },
  error: {
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
    fontSize: 11
  },
  battleBadge: {
    marginTop: theme.spacing.xs,
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: theme.colors.surfaceRaised,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4
  },
  battleBadgeLabel: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700'
  },
  voiceRow: {
    marginTop: theme.spacing.xs,
    alignSelf: 'flex-start'
  },
  voiceUnavailableText: {
    marginTop: 6,
    color: theme.colors.textSecondary,
    fontSize: 11,
    maxWidth: 220
  },
  voiceRetryButton: {
    marginTop: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5
  },
  voiceRetryLabel: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700'
  },
  retryButton: {
    marginTop: theme.spacing.xs,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6
  },
  retryLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700'
  },
  disabledButton: {
    opacity: 0.45
  },
  reactionBadge: {
    position: 'absolute',
    right: -10,
    bottom: -10,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  reactionEmoji: {
    fontSize: 14
  },
  upgradeButton: {
    marginTop: theme.spacing.xs,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.neonBlue,
    borderRadius: 8,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6
  },
  upgradeLabel: {
    color: theme.colors.neonBlue,
    fontSize: 12,
    fontWeight: '700'
  }
});
