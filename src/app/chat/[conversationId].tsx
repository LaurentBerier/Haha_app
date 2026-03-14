import { useCallback, useEffect, useMemo } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { ChatInput } from '../../components/chat/ChatInput';
import { MessageList } from '../../components/chat/MessageList';
import { StreamingIndicator } from '../../components/chat/StreamingIndicator';
import { BackButton } from '../../components/common/BackButton';
import { getModeById } from '../../config/modes';
import { useHeaderHorizontalInset } from '../../hooks/useHeaderHorizontalInset';
import { useChat } from '../../hooks/useChat';
import { t } from '../../i18n';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';
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
  const params = useLocalSearchParams<{ conversationId: string }>();
  const conversationId = params.conversationId ?? '';
  const isValidConversation = conversationId.length > 0;
  const headerHorizontalInset = useHeaderHorizontalInset();

  const sessionUser = useStore((state) => state.session?.user ?? null);
  const currentConversation = useStore(
    useCallback((state) => findConversationById(state.conversations, conversationId), [conversationId])
  );
  const { messages, sendMessage, retryMessage, hasStreaming, currentArtistName, isQuotaBlocked, audioPlayer } = useChat(conversationId);

  const userDisplayName = formatUserDisplayName(sessionUser?.displayName ?? null, sessionUser?.email ?? '');
  const artistDisplayName = formatArtistDisplayName(currentArtistName);
  const activeMode = useMemo(
    () => (currentConversation?.modeId ? getModeById(currentConversation.modeId) : null),
    [currentConversation?.modeId]
  );
  const activeModeLabel = activeMode?.name ?? t('chatModeUnknown');
  const activeModeEmoji = activeMode?.emoji ?? '💬';
  const chatHeaderTitle = `${activeModeEmoji} ${activeModeLabel}`;

  useEffect(() => {
    navigation.setOptions({
      title: isValidConversation ? chatHeaderTitle : t('chatTitle')
    });
  }, [chatHeaderTitle, isValidConversation, navigation]);

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
        <ChatInput onSend={sendMessage} disabled={!isValidConversation || isQuotaBlocked} />
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
