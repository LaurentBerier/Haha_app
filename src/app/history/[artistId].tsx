import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Header } from '../../components/common/Header';
import { getModeById } from '../../config/modes';
import { t } from '../../i18n';
import type { Conversation } from '../../models/Conversation';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';
import { formatDate } from '../../utils/formatDate';

const HISTORY_LIMIT = 20;

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

export default function HistoryScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';

  const artists = useStore((state) => state.artists);
  const conversationsByArtist = useStore((state) => state.conversations);
  const setActiveConversation = useStore((state) => state.setActiveConversation);

  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);

  const recentConversations = useMemo(() => {
    const source = conversationsByArtist[artistId] ?? [];

    return [...source]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, HISTORY_LIMIT);
  }, [artistId, conversationsByArtist]);

  const openConversation = useCallback(
    (conversation: Conversation) => {
      setActiveConversation(conversation.id);
      router.push(`/chat/${conversation.id}`);
    },
    [setActiveConversation]
  );

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => {
      const mode = getModeById(item.modeId);
      const modeName = mode?.name ?? item.modeId;
      const modeEmoji = mode?.emoji ?? '💬';
      const preview = item.lastMessagePreview?.trim() || t('newConversation');

      return (
        <Pressable
          testID={`history-item-${item.id}`}
          style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          onPress={() => openConversation(item)}
          accessibilityRole="button"
          accessibilityLabel={`${modeName} ${preview}`}
        >
          <View style={styles.modeRow}>
            <Text style={styles.modeEmoji}>{modeEmoji}</Text>
            <Text style={styles.modeName}>{modeName}</Text>
          </View>
          <Text style={styles.preview}>{truncate(preview, 60)}</Text>
          <Text style={styles.timestamp}>{formatDate(item.updatedAt)}</Text>
        </Pressable>
      );
    },
    [openConversation, t]
  );

  if (!artist) {
    return (
      <View style={styles.screen} testID="history-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="history-screen">
      <View style={styles.topRow}>
        <Pressable
          testID="history-back"
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="back"
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerWrap}>
          <Header title={t('historyScreenTitle')} subtitle={artist.name} />
        </View>
      </View>

      <FlatList
        data={recentConversations}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={<Text style={styles.emptyText}>{t('historyEmpty')}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    marginRight: theme.spacing.sm
  },
  backText: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    lineHeight: 24,
    marginTop: -2
  },
  headerWrap: {
    flex: 1,
    marginRight: 34 + theme.spacing.sm
  },
  listContent: {
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xl * 2
  },
  separator: {
    height: theme.spacing.sm
  },
  item: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    backgroundColor: theme.colors.artistBubble,
    padding: theme.spacing.md,
    gap: theme.spacing.xs
  },
  itemPressed: {
    opacity: 0.9
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm
  },
  modeEmoji: {
    fontSize: 18
  },
  modeName: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  },
  preview: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18
  },
  timestamp: {
    color: theme.colors.textMuted,
    fontSize: 11
  },
  emptyText: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: 40
  },
  errorText: {
    color: theme.colors.error,
    textAlign: 'center',
    marginTop: 30
  }
});
