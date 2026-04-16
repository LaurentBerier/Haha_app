import { memo, useCallback, useRef } from 'react';
import { FlatList, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { Message } from '../../models/Message';
import { t } from '../../i18n';
import { theme } from '../../theme';
import { ChatBubble } from './ChatBubble';
import type { AudioPlayerController } from '../../hooks/useAudioPlayer';
import {
  useBottomAnchoredMessageList,
  type TailFollowChangedPayload
} from '../../hooks/useBottomAnchoredMessageList';
import { resolveMessageListVerticalAlignment } from './messageListLayout';

interface MessageListProps {
  messages: Message[];
  userDisplayName: string;
  artistDisplayName: string;
  onRetryMessage?: (messageId: string) => void;
  onRetryVoice?: (messageId: string) => Promise<void> | void;
  onChooseMemeOption?: (messageId: string) => Promise<void> | void;
  onSaveMeme?: (messageId: string) => Promise<void> | void;
  onShareMeme?: (messageId: string) => Promise<void> | void;
  activeMemeOptionId?: string | null;
  activeMemeSaveMessageId?: string | null;
  activeMemeShareMessageId?: string | null;
  audioPlayer?: AudioPlayerController;
  testID?: string;
  listKey?: string;
  listStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  showEmptyState?: boolean;
  forceFollowSignal?: number;
  onTailFollowChanged?: (payload: TailFollowChangedPayload) => void;
  windowSize?: number;
  initialNumToRender?: number;
  maxToRenderPerBatch?: number;
  removeClippedSubviews?: boolean;
  disableVirtualization?: boolean;
}

function MessageListBase({
  messages,
  userDisplayName,
  artistDisplayName,
  onRetryMessage,
  onRetryVoice,
  onChooseMemeOption,
  onSaveMeme,
  onShareMeme,
  activeMemeOptionId,
  activeMemeSaveMessageId,
  activeMemeShareMessageId,
  audioPlayer,
  testID = 'message-list',
  listKey,
  listStyle,
  contentContainerStyle,
  showEmptyState = true,
  forceFollowSignal,
  onTailFollowChanged,
  windowSize = 8,
  initialNumToRender = 12,
  maxToRenderPerBatch,
  removeClippedSubviews,
  disableVirtualization
}: MessageListProps) {
  // Keep a ref to the latest audioPlayer so renderItem doesn't need it as a dep.
  // This prevents every ChatBubble from re-rendering on audio state ticks.
  const audioPlayerRef = useRef(audioPlayer);
  audioPlayerRef.current = audioPlayer;

  const verticalAlignment = resolveMessageListVerticalAlignment(messages.length);
  const {
    listRef,
    onContentSizeChange,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd
  } = useBottomAnchoredMessageList<Message>({
    itemCount: messages.length,
    resetKey: listKey,
    forceFollowSignal,
    onTailFollowChanged
  });

  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <ChatBubble
        message={item}
        userDisplayName={userDisplayName}
        artistDisplayName={artistDisplayName}
        onRetryMessage={onRetryMessage}
        onRetryVoice={onRetryVoice}
        onChooseMemeOption={onChooseMemeOption}
        onSaveMeme={onSaveMeme}
        onShareMeme={onShareMeme}
        activeMemeOptionId={activeMemeOptionId}
        activeMemeSaveMessageId={activeMemeSaveMessageId}
        activeMemeShareMessageId={activeMemeShareMessageId}
        audioPlayer={audioPlayerRef.current}
      />
    ),
    [
      activeMemeOptionId,
      activeMemeSaveMessageId,
      activeMemeShareMessageId,
      artistDisplayName,
      onChooseMemeOption,
      onRetryMessage,
      onRetryVoice,
      onSaveMeme,
      onShareMeme,
      userDisplayName
    ]
  );

  return (
    <FlatList
      key={listKey}
      ref={listRef}
      testID={testID}
      style={[styles.list, listStyle]}
      contentContainerStyle={[
        styles.content,
        verticalAlignment === 'bottom-anchored' ? styles.contentBottomAnchored : null,
        contentContainerStyle
      ]}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      windowSize={windowSize}
      initialNumToRender={initialNumToRender}
      maxToRenderPerBatch={maxToRenderPerBatch}
      removeClippedSubviews={removeClippedSubviews}
      disableVirtualization={disableVirtualization}
      onContentSizeChange={onContentSizeChange}
      onScroll={onScroll}
      onScrollBeginDrag={onScrollBeginDrag}
      onScrollEndDrag={onScrollEndDrag}
      onMomentumScrollBegin={onMomentumScrollBegin}
      onMomentumScrollEnd={onMomentumScrollEnd}
      scrollEventThrottle={16}
      ListEmptyComponent={
        showEmptyState ? (
          <View style={styles.emptyState} testID="message-list-empty">
            <Text style={styles.emptyEmoji}>🎤</Text>
            <Text style={styles.emptyTitle}>{t('chatEmptyHeadline')}</Text>
            <Text style={styles.emptySubtitle}>{t('chatEmptySubtext')}</Text>
          </View>
        ) : null
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
  contentBottomAnchored: {
    flexGrow: 1,
    justifyContent: 'flex-end'
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
