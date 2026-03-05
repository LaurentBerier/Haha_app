import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { ChatInput } from '../../components/chat/ChatInput';
import { MessageList } from '../../components/chat/MessageList';
import { StreamingIndicator } from '../../components/chat/StreamingIndicator';
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
  const params = useLocalSearchParams<{ conversationId: string }>();
  const conversationId = params.conversationId ?? '';
  const isValidConversation = conversationId.length > 0;

  const sessionUser = useStore((state) => state.session?.user ?? null);
  const conversations = useStore((state) => state.conversations);
  const artists = useStore((state) => state.artists);
  const { messages, sendMessage, hasStreaming } = useChat(conversationId);

  const currentConversation = useMemo(
    () => findConversationById(conversations, conversationId),
    [conversations, conversationId]
  );
  const currentArtistName = useMemo(() => {
    const artistId = currentConversation?.artistId;
    if (!artistId) {
      return null;
    }
    return artists.find((artist) => artist.id === artistId)?.name ?? null;
  }, [artists, currentConversation?.artistId]);

  const userDisplayName = formatUserDisplayName(sessionUser?.displayName ?? null, sessionUser?.email ?? '');
  const artistDisplayName = formatArtistDisplayName(currentArtistName);

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.screen}
      testID="chat-screen"
      keyboardVerticalOffset={88}
    >
      <View style={styles.container}>
        {isValidConversation ? (
          <MessageList messages={messages} userDisplayName={userDisplayName} artistDisplayName={artistDisplayName} />
        ) : (
          <Text style={styles.error} testID="chat-invalid-conversation">
            {t('invalidConversation')}
          </Text>
        )}
        {isValidConversation && hasStreaming ? <StreamingIndicator /> : null}
        <ChatInput onSend={sendMessage} disabled={!isValidConversation} />
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
    flex: 1
  },
  error: {
    color: theme.colors.error,
    textAlign: 'center',
    marginTop: 30
  }
});
