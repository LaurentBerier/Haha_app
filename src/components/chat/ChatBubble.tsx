import { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { t } from '../../i18n';
import type { Message } from '../../models/Message';
import { theme } from '../../theme';

interface ChatBubbleProps {
  message: Message;
}

function ChatBubbleBase({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const imageUri = message.metadata?.imageUri;
  const hasText = message.content.trim().length > 0;
  const shouldShowPlaceholder = !hasText && !imageUri;

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.artistRow]}>
      <View
        style={[styles.bubble, isUser ? styles.userBubble : styles.artistBubble]}
        testID={`chat-bubble-${message.role}-${message.id}`}
        accessibilityLabel={`chat-bubble-${message.role}`}
      >
        {imageUri ? <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" /> : null}

        {hasText || shouldShowPlaceholder ? (
          <Text style={styles.content} testID={`chat-bubble-content-${message.id}`}>
            {hasText ? message.content : '...'}
          </Text>
        ) : null}

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
    paddingHorizontal: theme.spacing.sm,
    marginVertical: theme.spacing.xs
  },
  userRow: {
    justifyContent: 'flex-end'
  },
  artistRow: {
    justifyContent: 'flex-start'
  },
  bubble: {
    maxWidth: '82%',
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
  content: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19
  },
  error: {
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
    fontSize: 11
  }
});
