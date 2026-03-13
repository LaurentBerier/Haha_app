import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
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
  const router = useRouter();
  const enterOpacity = useRef(new Animated.Value(0)).current;
  const enterTranslateY = useRef(new Animated.Value(6)).current;
  const isUser = message.role === 'user';
  const imageUri = message.metadata?.imageUri;
  const errorMessage =
    typeof message.metadata?.errorMessage === 'string' && message.metadata.errorMessage.trim()
      ? message.metadata.errorMessage.trim()
      : t('errorStreaming');
  const hasText = message.content.trim().length > 0;
  const shouldShowPlaceholder = !hasText && !imageUri;
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

  useEffect(() => {
    Animated.parallel([
      Animated.timing(enterOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }),
      Animated.timing(enterTranslateY, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      })
    ]).start();
  }, [enterOpacity, enterTranslateY]);

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

          {message.status === 'error' ? (
            <>
              <Text style={styles.error} testID={`chat-bubble-error-${message.id}`}>
                {errorMessage}
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
