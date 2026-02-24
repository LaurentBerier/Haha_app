import { memo, useCallback } from 'react';
import { FlatList, StyleSheet, Text } from 'react-native';
import type { Message } from '../../models/Message';
import { t } from '../../i18n';
import { theme } from '../../theme';
import { ChatBubble } from './ChatBubble';

interface MessageListProps {
  messages: Message[];
}

function MessageListBase({ messages }: MessageListProps) {
  const renderItem = useCallback(({ item }: { item: Message }) => <ChatBubble message={item} />, []);

  return (
    <FlatList
      testID="message-list"
      style={styles.list}
      contentContainerStyle={styles.content}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      windowSize={8}
      initialNumToRender={12}
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
    paddingVertical: theme.spacing.sm
  },
  empty: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: 40
  }
});
