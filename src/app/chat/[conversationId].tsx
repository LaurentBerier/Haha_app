import { useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { ChatInput } from '../../components/chat/ChatInput';
import { MessageList } from '../../components/chat/MessageList';
import { StreamingIndicator } from '../../components/chat/StreamingIndicator';
import { useChat } from '../../hooks/useChat';
import { t } from '../../i18n';
import { theme } from '../../theme';

export default function ChatScreen() {
  const params = useLocalSearchParams<{ conversationId: string }>();
  const conversationId = params.conversationId ?? '';
  const isValidConversation = conversationId.length > 0;
  const { messages, sendMessage, hasStreaming } = useChat(conversationId);

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.screen}
      testID="chat-screen"
      keyboardVerticalOffset={88}
    >
      <View style={styles.container}>
        {isValidConversation ? (
          <MessageList messages={messages} />
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
