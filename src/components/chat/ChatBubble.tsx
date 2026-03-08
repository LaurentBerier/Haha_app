import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../../i18n';
import type { Message } from '../../models/Message';
import { theme } from '../../theme';

interface ChatBubbleProps {
  message: Message;
  userDisplayName: string;
  artistDisplayName: string;
  onRetryMessage?: (messageId: string) => void;
}

function ChatBubbleBase({ message, userDisplayName, artistDisplayName, onRetryMessage }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const imageUri = message.metadata?.imageUri;
  const hasText = message.content.trim().length > 0;
  const shouldShowPlaceholder = !hasText && !imageUri;
  const senderName = isUser ? userDisplayName : artistDisplayName;

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.artistRow]}>
      <View style={[styles.block, isUser ? styles.userBlock : styles.artistBlock]}>
        <Text
          style={[styles.senderName, isUser ? styles.userSenderName : styles.artistSenderName]}
          numberOfLines={1}
          testID={`chat-bubble-sender-${message.id}`}
        >
          {senderName}
        </Text>
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
            <>
              <Text style={styles.error} testID={`chat-bubble-error-${message.id}`}>
                {t('errorStreaming')}
              </Text>
              {onRetryMessage ? (
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
        </View>
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
  content: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19
  },
  error: {
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
    fontSize: 11
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
  }
});
