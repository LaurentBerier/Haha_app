import { memo, useCallback, useEffect, useRef } from 'react';
import { FlatList, type NativeScrollEvent, type NativeSyntheticEvent, StyleSheet, Text } from 'react-native';
import type { Message } from '../../models/Message';
import { t } from '../../i18n';
import { theme } from '../../theme';
import { ChatBubble } from './ChatBubble';

interface MessageListProps {
  messages: Message[];
}

function MessageListBase({ messages }: MessageListProps) {
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

  const renderItem = useCallback(({ item }: { item: Message }) => <ChatBubble message={item} />, []);

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
        <Text style={styles.empty} testID="message-list-empty">
          {t('noMessages')}
        </Text>
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
    paddingBottom: 108
  },
  empty: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: 40
  }
});
