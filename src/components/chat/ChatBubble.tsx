import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Message } from '../../models/Message';
import { theme } from '../../theme';
import { t } from '../../i18n';

interface ChatBubbleProps {
  message: Message;
}

function ChatBubbleBase({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.artistRow]}>
      <View
        style={[styles.bubble, isUser ? styles.userBubble : styles.artistBubble]}
        testID={`chat-bubble-${message.role}-${message.id}`}
        accessibilityLabel={`chat-bubble-${message.role}`}
      >
        <Text style={styles.content} testID={`chat-bubble-content-${message.id}`}>
          {message.content || '...'}
        </Text>
        {message.status === 'error' ? (
          <Text style={styles.error} testID={`chat-bubble-error-${message.id}`}>
            {t('errorStreaming')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export const ChatBubble = memo(ChatBubbleBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.md,
    marginVertical: theme.spacing.xs
  },
  userRow: {
    justifyContent: 'flex-end'
  },
  artistRow: {
    justifyContent: 'flex-start'
  },
  bubble: {
    maxWidth: '84%',
    borderRadius: 12,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    minHeight: 44
  },
  userBubble: {
    backgroundColor: theme.colors.userBubble
  },
  artistBubble: {
    backgroundColor: theme.colors.artistBubble,
    borderWidth: 1,
    borderColor: theme.colors.border
  },
  content: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 20
  },
  error: {
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
    fontSize: 12
  }
});
