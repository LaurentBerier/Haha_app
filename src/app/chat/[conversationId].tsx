import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { ChatInput } from '../../components/chat/ChatInput';
import { MessageList } from '../../components/chat/MessageList';
import { StreamingIndicator } from '../../components/chat/StreamingIndicator';
import { ThreadModeHeader } from '../../components/chat/ThreadModeHeader';
import { useToast } from '../../components/common/ToastProvider';
import { BackButton } from '../../components/common/BackButton';
import { resolveModeIdCompat } from '../../config/modeCompat';
import { getModeById } from '../../config/modes';
import { useHeaderHorizontalInset } from '../../hooks/useHeaderHorizontalInset';
import { useAutoReplayLastArtistMessage } from '../../hooks/useAutoReplayLastArtistMessage';
import { useChat } from '../../hooks/useChat';
import { useVoiceConversation } from '../../hooks/useVoiceConversation';
import { t } from '../../i18n';
import type { ChatSendPayload } from '../../models/ChatSendPayload';
import { normalizeConversationThreadType } from '../../models/Conversation';
import { tryLaunchExperienceFromText } from '../../services/experienceLaunchService';
import { attemptVoiceAutoplayUri } from '../../services/voiceAutoplayService';
import { getRandomFillerUri, prewarmVoiceFillers } from '../../services/voiceFillerService';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';
import { hasVoiceAccessForAccountType, resolveEffectiveAccountType } from '../../utils/accountTypeUtils';
import { findConversationById } from '../../utils/conversationUtils';
import { resolveModeNudgeAutoArmDecision } from './chatAutoArm';

function formatUserDisplayName(displayName: string | null, email: string): string {
  const trimmed = displayName?.trim();
  if (trimmed) {
    return trimmed;
  }

  const emailPrefix = email.split('@')[0]?.trim();
  return emailPrefix || t('chatUserFallbackName');
}

function formatArtistDisplayName(artistName: string | null): string {
  if (!artistName) {
    return t('chatDefaultArtistName');
  }

  if (artistName === 'Cathy Gauthier') {
    return t('chatDefaultArtistName');
  }

  return artistName;
}

export default function ChatScreen() {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    conversationId?: string | string[];
    queuedNonce?: string | string[];
  }>();
  const conversationIdParam = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;
  const queuedNonceParam = Array.isArray(params.queuedNonce) ? params.queuedNonce[0] : params.queuedNonce;
  const conversationId = conversationIdParam ?? '';
  const isValidConversation = conversationId.length > 0;
  const [hasTypedDraft, setHasTypedDraft] = useState(false);
  const [activeMemeOptionId, setActiveMemeOptionId] = useState<string | null>(null);
  const [activeMemeSaveMessageId, setActiveMemeSaveMessageId] = useState<string | null>(null);
  const [activeMemeShareMessageId, setActiveMemeShareMessageId] = useState<string | null>(null);
  const handledQueuedNonceRef = useRef<string | null>(null);
  const handledModeNudgeIdsRef = useRef<Set<string>>(new Set());
  const headerHorizontalInset = useHeaderHorizontalInset();
  const toast = useToast();

  const sessionUser = useStore((state) => state.session?.user ?? null);
  const accessToken = useStore((state) => state.session?.accessToken ?? '');
  const language = useStore((state) => state.language);
  const conversationModeEnabled = useStore((state) => state.conversationModeEnabled);
  const isVoiceInputBlocked = useStore((state) => state.isVoiceInputBlocked());
  const setConversationModeEnabled = useStore((state) => state.setConversationModeEnabled);
  const voiceAutoPlay = useStore((state) => state.voiceAutoPlay);
  const consumeChatSendPayload = useStore((state) => state.consumeChatSendPayload);
  const currentConversation = useStore(
    useCallback((state) => findConversationById(state.conversations, conversationId), [conversationId])
  );
  const conversationLanguage = currentConversation?.language?.trim() ? currentConversation.language : language;
  const {
    messages,
    sendMessage,
    chooseMemeOption,
    saveMemeAsset,
    shareMemeAsset,
    retryMessage,
    retryVoiceForMessage,
    hasStreaming,
    currentArtistName,
    isQuotaBlocked,
    isSendContextReady,
    audioPlayer
  } = useChat(conversationId);
  const isChatComposerDisabled = !isValidConversation || isQuotaBlocked || !isSendContextReady;
  const sendWithFillerRef = useRef<(payload: ChatSendPayload) => unknown>(() => null);

  const {
    isListening,
    transcript,
    error: conversationError,
    status: conversationStatus,
    hint: conversationHint,
    pauseListening,
    resumeListening,
    armListeningActivation
  } =
    useVoiceConversation({
    enabled: conversationModeEnabled && !isChatComposerDisabled && !isVoiceInputBlocked,
    disabled: isChatComposerDisabled,
    hasTypedDraft,
    isPlaying: audioPlayer.isPlaying || audioPlayer.isLoading || hasStreaming,
    isAudioPlaybackLoading: audioPlayer.isLoading,
    onSend: (text) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }
      sendWithFillerRef.current({ text: normalized });
    },
    onStopAudio: () => {
      audioPlayer.gracefulStop();
    },
    language: conversationLanguage,
    fallbackLanguage: language
    });

  const userDisplayName = formatUserDisplayName(sessionUser?.displayName ?? null, sessionUser?.email ?? '');
  const artistDisplayName = formatArtistDisplayName(currentArtistName);
  const conversationThreadType = normalizeConversationThreadType(currentConversation?.threadType);
  const isPrimaryThread = conversationThreadType === 'primary';
  const activeMode = useMemo(() => {
    if (isPrimaryThread) {
      return null;
    }
    const modeId = currentConversation?.modeId?.trim();
    if (!modeId) {
      return null;
    }
    return getModeById(resolveModeIdCompat(modeId));
  }, [currentConversation?.modeId, isPrimaryThread]);
  const effectiveAccountType = useMemo(
    () => resolveEffectiveAccountType(sessionUser?.accountType ?? null, sessionUser?.role ?? null),
    [sessionUser?.accountType, sessionUser?.role]
  );
  const activeModeLabel = isPrimaryThread ? t('primaryThreadTitle') : activeMode?.name ?? t('chatModeUnknown');
  const activeModeEmoji = isPrimaryThread ? '💬' : activeMode?.emoji ?? '💬';
  const chatHeaderTitle = `${activeModeEmoji} ${activeModeLabel}`;
  const shouldUseVoiceFiller = Boolean(
      conversationModeEnabled &&
      currentConversation?.artistId &&
      accessToken.trim() &&
      hasVoiceAccessForAccountType(effectiveAccountType)
  );

  const sendWithFiller = useCallback(
    (payload: ChatSendPayload) => {
      const normalizedText = payload.text.trim();
      if (normalizedText && !payload.image && currentConversation?.artistId) {
        const launchOutcome = tryLaunchExperienceFromText({
          artistId: currentConversation.artistId,
          text: normalizedText,
          fallbackLanguage: language,
          preferredConversationLanguage: conversationLanguage
        });
        if (launchOutcome.launched) {
          return null;
        }
      }

      if (
        shouldUseVoiceFiller &&
        !audioPlayer.isPlaying &&
        !audioPlayer.isLoading &&
        currentConversation?.artistId
      ) {
        void getRandomFillerUri(currentConversation.artistId, conversationLanguage, accessToken)
          .then((uri) => {
            if (!uri) {
              return;
            }
            if (!audioPlayer.isPlaying && !audioPlayer.isLoading) {
              void attemptVoiceAutoplayUri({
                audioPlayer,
                uri
              });
            }
          })
          .catch(() => {
            // Non-blocking latency helper.
          });
      }

      return sendMessage(payload);
    },
    [
      accessToken,
      audioPlayer,
      conversationLanguage,
      currentConversation?.artistId,
      language,
      sendMessage,
      shouldUseVoiceFiller
    ]
  );

  useEffect(() => {
    sendWithFillerRef.current = sendWithFiller;
  }, [sendWithFiller]);

  useEffect(() => {
    navigation.setOptions({
      title: isValidConversation ? chatHeaderTitle : t('chatTitle')
    });
  }, [chatHeaderTitle, isValidConversation, navigation]);

  useEffect(() => {
    if (!shouldUseVoiceFiller || !currentConversation?.artistId) {
      return;
    }
    prewarmVoiceFillers(currentConversation.artistId, conversationLanguage, accessToken);
  }, [accessToken, conversationLanguage, currentConversation?.artistId, shouldUseVoiceFiller]);

  useEffect(() => {
    const queuedNonce = queuedNonceParam?.trim() ?? '';
    if (!isValidConversation || !queuedNonce) {
      return;
    }
    if (handledQueuedNonceRef.current === queuedNonce) {
      return;
    }
    handledQueuedNonceRef.current = queuedNonce;

    const queuedPayload = consumeChatSendPayload(conversationId, queuedNonce);
    if (queuedPayload) {
      sendWithFiller(queuedPayload);
    }
  }, [consumeChatSendPayload, conversationId, isValidConversation, queuedNonceParam, sendWithFiller]);

  useEffect(() => {
    const autoArmDecision = resolveModeNudgeAutoArmDecision({
      isValidConversation,
      conversationThreadType,
      messages,
      conversationModeEnabled,
      hasStreaming,
      isQuotaBlocked,
      hasTypedDraft,
      isComposerDisabled: isChatComposerDisabled
    });
    const candidateMessageId = autoArmDecision.candidateModeNudgeMessageId;
    if (!candidateMessageId) {
      return;
    }

    if (handledModeNudgeIdsRef.current.has(candidateMessageId)) {
      return;
    }

    if (autoArmDecision.consumeCandidateWithoutAutoArm) {
      handledModeNudgeIdsRef.current.add(candidateMessageId);
      return;
    }

    if (!autoArmDecision.shouldAutoArm) {
      return;
    }

    armListeningActivation();
    handledModeNudgeIdsRef.current.add(candidateMessageId);
  }, [
    armListeningActivation,
    conversationModeEnabled,
    conversationThreadType,
    hasStreaming,
    hasTypedDraft,
    isChatComposerDisabled,
    isQuotaBlocked,
    isValidConversation,
    messages
  ]);

  useAutoReplayLastArtistMessage({
    messages,
    audioPlayer,
    enabled: isValidConversation,
    hasStreaming,
    voiceAutoPlay: voiceAutoPlay || conversationModeEnabled,
    replayOnFocus: false
  });

  useEffect(() => {
    if (!conversationModeEnabled || isChatComposerDisabled || !isValidConversation) {
      return;
    }

    resumeListening();
  }, [conversationModeEnabled, isChatComposerDisabled, isValidConversation, isVoiceInputBlocked, resumeListening]);

  const handleChooseMemeOption = useCallback(
    async (messageId: string): Promise<void> => {
      if (activeMemeOptionId) {
        return;
      }
      setActiveMemeOptionId(messageId);
      try {
        await chooseMemeOption(messageId);
      } finally {
        setActiveMemeOptionId(null);
      }
    },
    [activeMemeOptionId, chooseMemeOption]
  );

  const handleSaveMeme = useCallback(
    async (messageId: string): Promise<void> => {
      if (activeMemeSaveMessageId || activeMemeShareMessageId) {
        return;
      }
      setActiveMemeSaveMessageId(messageId);
      try {
        const result = await saveMemeAsset(messageId);
        if (result === 'saved') {
          toast.success(t('memeSavedSuccess'));
          return;
        }
        if (result === 'permission_denied') {
          toast.error(t('memeSavePermissionDenied'));
          return;
        }
        toast.error(t('memeSaveFailed'));
      } finally {
        setActiveMemeSaveMessageId(null);
      }
    },
    [activeMemeSaveMessageId, activeMemeShareMessageId, saveMemeAsset, toast]
  );

  const handleShareMeme = useCallback(
    async (messageId: string): Promise<void> => {
      if (activeMemeSaveMessageId || activeMemeShareMessageId) {
        return;
      }
      setActiveMemeShareMessageId(messageId);
      try {
        const result = await shareMemeAsset(messageId);
        if (result === 'shared') {
          toast.success(t('memeSharedSuccess'));
          return;
        }
        if (result === 'share_cancelled') {
          return;
        }
        toast.error(t('memeShareFailed'));
      } finally {
        setActiveMemeShareMessageId(null);
      }
    },
    [activeMemeSaveMessageId, activeMemeShareMessageId, shareMemeAsset, toast]
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.screen}
      testID="chat-screen"
      keyboardVerticalOffset={88}
    >
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="chat-back" />
      </View>
      <View style={styles.container}>
        {isValidConversation ? (
          <>
            <ThreadModeHeader
              title={activeModeLabel}
              subtitle={isPrimaryThread ? t('primaryThreadSubtitle') : activeMode?.description ?? ''}
              testID="chat-thread-mode-header"
            />
            <MessageList
              messages={messages}
              userDisplayName={userDisplayName}
              artistDisplayName={artistDisplayName}
              onRetryMessage={retryMessage}
              onRetryVoice={retryVoiceForMessage}
              onChooseMemeOption={handleChooseMemeOption}
              onSaveMeme={handleSaveMeme}
              onShareMeme={handleShareMeme}
              activeMemeOptionId={activeMemeOptionId}
              activeMemeSaveMessageId={activeMemeSaveMessageId}
              activeMemeShareMessageId={activeMemeShareMessageId}
              audioPlayer={audioPlayer}
            />
          </>
        ) : (
          <Text style={styles.error} testID="chat-invalid-conversation">
            {t('invalidConversation')}
          </Text>
        )}
        {isValidConversation && hasStreaming ? <StreamingIndicator /> : null}
        <ChatInput
          onSend={sendWithFiller}
          disabled={isChatComposerDisabled}
          conversationMode={{
            enabled: conversationModeEnabled,
            isListening,
            transcript,
            error: conversationError,
            micState: conversationStatus,
            hint: conversationHint,
            onToggle: () => {
              setConversationModeEnabled(true);
            },
            onPauseListening: () => {
              setConversationModeEnabled(false);
              pauseListening();
            },
            onResumeListening: resumeListening,
            onTypingStateChange: setHasTypedDraft
          }}
        />
        {isValidConversation && isQuotaBlocked ? (
          <Text style={styles.blockedHint}>{t('chatInputBlocked')}</Text>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 784,
    alignSelf: 'center'
  },
  topRow: {
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs
  },
  error: {
    color: theme.colors.error,
    textAlign: 'center',
    marginTop: 30
  },
  blockedHint: {
    color: theme.colors.textSecondary,
    textAlign: 'center',
    fontSize: 12,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm
  }
});
