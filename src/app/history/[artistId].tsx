import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { BackButton } from '../../components/common/BackButton';
import { useHeaderHorizontalInset } from '../../hooks/useHeaderHorizontalInset';
import { getModeById } from '../../config/modes';
import { t } from '../../i18n';
import type { Conversation } from '../../models/Conversation';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';
import { formatDate } from '../../utils/formatDate';

const HISTORY_LIMIT = 20;
type HistorySection = { title: string; data: Conversation[] };

function getStartOfTodayMs(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function getStartOfWeekMs(now: Date): number {
  const day = now.getDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  const startOfToday = getStartOfTodayMs(now);
  return startOfToday - mondayOffset * 24 * 60 * 60 * 1000;
}

function buildHistorySections(conversations: Conversation[]): HistorySection[] {
  const now = new Date();
  const startOfToday = getStartOfTodayMs(now);
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = getStartOfWeekMs(now);

  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const thisWeek: Conversation[] = [];
  const earlier: Conversation[] = [];

  for (const conversation of conversations) {
    const updatedAtMs = Date.parse(conversation.updatedAt);
    if (!Number.isFinite(updatedAtMs)) {
      earlier.push(conversation);
      continue;
    }

    if (updatedAtMs >= startOfToday) {
      today.push(conversation);
      continue;
    }

    if (updatedAtMs >= startOfYesterday) {
      yesterday.push(conversation);
      continue;
    }

    if (updatedAtMs >= startOfWeek) {
      thisWeek.push(conversation);
      continue;
    }

    earlier.push(conversation);
  }

  const sections: HistorySection[] = [];
  if (today.length > 0) {
    sections.push({ title: t('historyGroupToday'), data: today });
  }
  if (yesterday.length > 0) {
    sections.push({ title: t('historyGroupYesterday'), data: yesterday });
  }
  if (thisWeek.length > 0) {
    sections.push({ title: t('historyGroupThisWeek'), data: thisWeek });
  }
  if (earlier.length > 0) {
    sections.push({ title: t('historyGroupEarlier'), data: earlier });
  }

  return sections;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

export default function HistoryScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';
  const headerHorizontalInset = useHeaderHorizontalInset();

  const artists = useStore((state) => state.artists);
  const conversationsByArtist = useStore((state) => state.conversations);
  const setActiveConversation = useStore((state) => state.setActiveConversation);
  const hasHydrated = useStore((state) => state.hasHydrated);

  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);

  const historySections = useMemo(() => {
    const source = conversationsByArtist[artistId] ?? [];
    const recentConversations = [...source]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, HISTORY_LIMIT);
    return buildHistorySections(recentConversations);
  }, [artistId, conversationsByArtist]);

  const openConversation = useCallback(
    (conversation: Conversation) => {
      setActiveConversation(conversation.id);
      router.push(`/chat/${conversation.id}`);
    },
    [setActiveConversation]
  );

  const openGames = useCallback(() => {
    router.push(`/games/${artistId}`);
  }, [artistId]);

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
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="history-back" />
        <View style={styles.headerWrap}>
          <Text style={styles.subtitle}>{artist.name}</Text>
        </View>
      </View>

      <SectionList
        sections={hasHydrated ? historySections : []}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        ListHeaderComponent={
          <Pressable
            onPress={openGames}
            style={({ pressed }) => [styles.gamesBanner, pressed ? styles.gamesBannerPressed : null]}
            accessibilityRole="button"
            testID="history-games-banner"
          >
            <View style={styles.gamesBannerIconWrap}>
              <Text style={styles.gamesBannerIcon}>🎮</Text>
            </View>
            <View style={styles.gamesBannerTextWrap}>
              <Text style={styles.gamesBannerTitle}>{t('gamesSection')}</Text>
              <Text style={styles.gamesBannerSubtitle}>{t('gamesSectionSubtitle')}</Text>
            </View>
            <Text style={styles.gamesBannerChevron}>›</Text>
          </Pressable>
        }
        contentContainerStyle={styles.listContent}
        style={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          hasHydrated ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🗂️</Text>
              <Text style={styles.emptyTitle}>{t('historyEmptyHeadline')}</Text>
              <Text style={styles.emptyText}>{t('historyEmptySubtext')}</Text>
            </View>
          ) : (
            <View style={styles.skeletonList}>
              {Array.from({ length: 4 }).map((_, index) => (
                <View key={`history-skeleton-${index}`} style={styles.skeletonCard}>
                  <View style={styles.skeletonHeader} />
                  <View style={styles.skeletonLine} />
                  <View style={styles.skeletonTimestamp} />
                </View>
              ))}
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingTop: theme.spacing.sm
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: theme.spacing.xs,
    gap: theme.spacing.sm
  },
  headerWrap: {
    flex: 1
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600'
  },
  list: {
    width: '100%',
    maxWidth: 608,
    alignSelf: 'center'
  },
  listContent: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xl * 2
  },
  gamesBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.neonBlue,
    borderRadius: 12,
    backgroundColor: theme.colors.artistBubble,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.sm
  },
  gamesBannerPressed: {
    opacity: 0.94
  },
  gamesBannerIconWrap: {
    width: 30,
    alignItems: 'center'
  },
  gamesBannerIcon: {
    fontSize: 18
  },
  gamesBannerTextWrap: {
    flex: 1,
    gap: 2
  },
  gamesBannerTitle: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  },
  gamesBannerSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 12
  },
  gamesBannerChevron: {
    color: theme.colors.textMuted,
    fontSize: 24,
    lineHeight: 24
  },
  separator: {
    height: theme.spacing.sm
  },
  sectionHeader: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs
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
    fontSize: 13
  },
  emptyState: {
    marginTop: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.lg
  },
  skeletonList: {
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.sm
  },
  skeletonCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    backgroundColor: theme.colors.artistBubble,
    padding: theme.spacing.md,
    gap: theme.spacing.xs
  },
  skeletonHeader: {
    width: '42%',
    height: 14,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceButton
  },
  skeletonLine: {
    width: '75%',
    height: 12,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceSunken
  },
  skeletonTimestamp: {
    width: '25%',
    height: 10,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceSunken
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
  errorText: {
    color: theme.colors.error,
    textAlign: 'center',
    marginTop: 30
  }
});
