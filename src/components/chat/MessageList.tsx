import { memo, useCallback, useEffect, useRef } from 'react';
import { FlatList, type NativeScrollEvent, type NativeSyntheticEvent, StyleSheet, Text, View } from 'react-native';
import type { Message } from '../../models/Message';
import { t } from '../../i18n';
import { theme } from '../../theme';
import { ChatBubble } from './ChatBubble';
import type { AudioPlayerController } from '../../hooks/useAudioPlayer';

interface MessageListProps {
  messages: Message[];
  userDisplayName: string;
  artistDisplayName: string;
  onRetryMessage?: (messageId: string) => void;
  onRetryVoice?: (messageId: string) => Promise<void> | void;
  audioPlayer?: AudioPlayerController;
}

function MessageListBase({
  messages,
  userDisplayName,
  artistDisplayName,
  onRetryMessage,
  onRetryVoice,
  audioPlayer
}: MessageListProps) {
  const listRef = useRef<FlatList<Message>>(null);
  const isNearBottomRef = useRef(true);
  const hasScrolledInitiallyRef = useRef(false);

  const scrollToLatest = useCallback((animated: boolean) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    if (!hasScrolledInitiallyRef.current) {
      return;
    }

    if (isNearBottomRef.current) {
      scrollToLatest(true);
    }
  }, [messages, scrollToLatest]);

  const handleContentSizeChange = useCallback(() => {
    if (!hasScrolledInitiallyRef.current) {
      hasScrolledInitiallyRef.current = true;
      scrollToLatest(false);
      return;
    }

    if (isNearBottomRef.current) {
      scrollToLatest(true);
    }
  }, [scrollToLatest]);

  const handleScroll = useCallback(({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = nativeEvent.contentOffset?.y ?? 0;
    const contentHeight = nativeEvent.contentSize?.height ?? 0;
    const layoutHeight = nativeEvent.layoutMeasurement?.height ?? 0;
    const distanceFromBottom = contentHeight - (offsetY + layoutHeight);

    isNearBottomRef.current = distanceFromBottom < 80;
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <ChatBubble
        message={item}
        userDisplayName={userDisplayName}
        artistDisplayName={artistDisplayName}
        onRetryMessage={onRetryMessage}
        onRetryVoice={onRetryVoice}
        audioPlayer={audioPlayer}
      />
    ),
    [artistDisplayName, audioPlayer, onRetryMessage, onRetryVoice, userDisplayName]
  );

  return (
    <FlatList
      ref={listRef}
      testID="message-list"
      style={styles.list}
      contentContainerStyle={styles.content}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      windowSize={8}
      initialNumToRender={12}
      onContentSizeChange={handleContentSizeChange}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      ListEmptyComponent={
        <View style={styles.emptyState} testID="message-list-empty">
          <Text style={styles.emptyEmoji}>🎤</Text>
          <Text style={styles.emptyTitle}>{t('chatEmptyHeadline')}</Text>
          <Text style={styles.emptySubtitle}>{t('chatEmptySubtext')}</Text>
        </View>
      }
    />
  );
}

export const MessageList = memo(MessageListBase);

const styles = StyleSheet.create({
  list: {
    flex: 1
  },
  content: {
    paddingVertical: theme.spacing.sm,
    paddingBottom: 96
  },
  emptyState: {
    marginTop: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.lg
  },
  emptyEmoji: {
    fontSize: 28
  },
  emptyTitle: {
    color: theme.colors.textPrimary,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700'
  },
  emptySubtitle: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    fontSize: 13
  }
});
