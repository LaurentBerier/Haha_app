import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { ChatInput } from '../../components/chat/ChatInput';
import { MessageList } from '../../components/chat/MessageList';
import { StreamingIndicator } from '../../components/chat/StreamingIndicator';
import { BackButton } from '../../components/common/BackButton';
import { getModeById } from '../../config/modes';
import { useHeaderHorizontalInset } from '../../hooks/useHeaderHorizontalInset';
import { useAutoReplayLastArtistMessage } from '../../hooks/useAutoReplayLastArtistMessage';
import { useChat } from '../../hooks/useChat';
import { useVoiceConversation } from '../../hooks/useVoiceConversation';
import { t } from '../../i18n';
import type { ChatSendPayload } from '../../models/ChatSendPayload';
import { getRandomFillerUri, prewarmVoiceFillers } from '../../services/voiceFillerService';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';
import { hasVoiceAccessForAccountType, resolveEffectiveAccountType } from '../../utils/accountTypeUtils';
import { findConversationById } from '../../utils/conversationUtils';

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
  const handledQueuedNonceRef = useRef<string | null>(null);
  const headerHorizontalInset = useHeaderHorizontalInset();

  const sessionUser = useStore((state) => state.session?.user ?? null);
  const accessToken = useStore((state) => state.session?.accessToken ?? '');
  const language = useStore((state) => state.language);
  const conversationModeEnabled = useStore((state) => state.conversationModeEnabled);
  const setConversationModeEnabled = useStore((state) => state.setConversationModeEnabled);
  const setVoiceAutoPlay = useStore((state) => state.setVoiceAutoPlay);
  const consumeChatSendPayload = useStore((state) => state.consumeChatSendPayload);
  const currentConversation = useStore(
    useCallback((state) => findConversationById(state.conversations, conversationId), [conversationId])
  );
  const { messages, sendMessage, retryMessage, hasStreaming, currentArtistName, isQuotaBlocked, audioPlayer } = useChat(conversationId);
  const sendWithFillerRef = useRef<(payload: ChatSendPayload) => unknown>(() => null);

  const {
    isListening,
    transcript,
    error: conversationError,
    status: conversationStatus,
    hint: conversationHint,
    pauseListening,
    resumeListening
  } =
    useVoiceConversation({
    enabled: conversationModeEnabled && !isQuotaBlocked && isValidConversation,
    disabled: !isValidConversation || isQuotaBlocked,
    hasTypedDraft,
    isPlaying: audioPlayer.isPlaying || audioPlayer.isLoading || hasStreaming,
    onSend: (text) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }
      sendWithFillerRef.current({ text: normalized });
    },
    onStopAudio: () => {
      void audioPlayer.stop();
    },
    language
    });

  const userDisplayName = formatUserDisplayName(sessionUser?.displayName ?? null, sessionUser?.email ?? '');
  const artistDisplayName = formatArtistDisplayName(currentArtistName);
  const activeMode = useMemo(
    () => (currentConversation?.modeId ? getModeById(currentConversation.modeId) : null),
    [currentConversation?.modeId]
  );
  const effectiveAccountType = useMemo(
    () => resolveEffectiveAccountType(sessionUser?.accountType ?? null, sessionUser?.role ?? null),
    [sessionUser?.accountType, sessionUser?.role]
  );
  const activeModeLabel = activeMode?.name ?? t('chatModeUnknown');
  const activeModeEmoji = activeMode?.emoji ?? '💬';
  const chatHeaderTitle = `${activeModeEmoji} ${activeModeLabel}`;
  const shouldUseVoiceFiller = Boolean(
      conversationModeEnabled &&
      currentConversation?.artistId &&
      accessToken.trim() &&
      hasVoiceAccessForAccountType(effectiveAccountType)
  );

  const sendWithFiller = useCallback(
    (payload: ChatSendPayload) => {
      if (
        shouldUseVoiceFiller &&
        !audioPlayer.isPlaying &&
        !audioPlayer.isLoading &&
        currentConversation?.artistId
      ) {
        void getRandomFillerUri(currentConversation.artistId, language, accessToken)
          .then((uri) => {
            if (!uri) {
              return;
            }
            if (!audioPlayer.isPlaying && !audioPlayer.isLoading) {
              void audioPlayer.play(uri);
            }
          })
          .catch(() => {
            // Non-blocking latency helper.
          });
      }

      return sendMessage(payload);
    },
    [accessToken, audioPlayer, currentConversation?.artistId, language, sendMessage, shouldUseVoiceFiller]
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
    setVoiceAutoPlay(conversationModeEnabled);
  }, [conversationModeEnabled, setVoiceAutoPlay]);

  useEffect(() => {
    if (!shouldUseVoiceFiller || !currentConversation?.artistId) {
      return;
    }
    prewarmVoiceFillers(currentConversation.artistId, language, accessToken);
  }, [accessToken, currentConversation?.artistId, language, shouldUseVoiceFiller]);

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

  useAutoReplayLastArtistMessage({
    messages,
    audioPlayer,
    enabled: isValidConversation,
    hasStreaming
  });

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
          <MessageList
            messages={messages}
            userDisplayName={userDisplayName}
            artistDisplayName={artistDisplayName}
            onRetryMessage={retryMessage}
            audioPlayer={audioPlayer}
          />
        ) : (
          <Text style={styles.error} testID="chat-invalid-conversation">
            {t('invalidConversation')}
          </Text>
        )}
        {isValidConversation && hasStreaming ? <StreamingIndicator /> : null}
        <ChatInput
          onSend={sendWithFiller}
          disabled={!isValidConversation || isQuotaBlocked}
          conversationMode={{
            enabled: conversationModeEnabled,
            isListening,
            transcript,
            error: conversationError,
            micState: conversationStatus,
            hint: conversationHint,
            onToggle: () => {
              setConversationModeEnabled(!conversationModeEnabled);
            },
            onPauseListening: pauseListening,
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
