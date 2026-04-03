import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BackButton } from '../../components/common/BackButton';
import { getModeById } from '../../config/modes';
import { useHeaderHorizontalInset } from '../../hooks/useHeaderHorizontalInset';
import { t } from '../../i18n';
import { normalizeConversationThreadType, type Conversation } from '../../models/Conversation';
import type { Artist } from '../../models/Artist';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';
import { formatDate, formatShortDate } from '../../utils/formatDate';

const HISTORY_LIMIT_PER_ARTIST = 20;

type HistorySection = { title: string; data: Conversation[] };
type ArtistHistoryGroup = {
  artist: Artist;
  sections: HistorySection[];
  latestUpdatedAtMs: number;
};

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

function resolveArchivedThreadTitle(updatedAt: string): string {
  const title = t('historyArchivedThreadTitle');
  const shortDate = formatShortDate(updatedAt);
  if (!shortDate) {
    return title;
  }
  return `${title} (${shortDate})`;
}

export default function HistoryScreen() {
  const headerHorizontalInset = useHeaderHorizontalInset();
  const artists = useStore((state) => state.artists);
  const unlockedArtistIds = useStore((state) => state.unlockedArtistIds);
  const conversationsByArtist = useStore((state) => state.conversations);
  const hasHydrated = useStore((state) => state.hasHydrated);
  const language = useStore((state) => state.language);
  const setActiveConversation = useStore((state) => state.setActiveConversation);
  const setModeSelectSessionHubConversation = useStore((state) => state.setModeSelectSessionHubConversation);
  const createAndPromotePrimaryConversation = useStore((state) => state.createAndPromotePrimaryConversation);

  const artistGroups = useMemo(() => {
    const unlockedIds = new Set(unlockedArtistIds);
    const groups: ArtistHistoryGroup[] = [];

    for (const artist of artists) {
      if (!unlockedIds.has(artist.id)) {
        continue;
      }

      const source = conversationsByArtist[artist.id] ?? [];
      if (source.length === 0) {
        continue;
      }

      const recentConversations = [...source]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, HISTORY_LIMIT_PER_ARTIST);
      const sections = buildHistorySections(recentConversations);
      if (sections.length === 0) {
        continue;
      }

      const latestUpdatedAtMs = Date.parse(recentConversations[0]?.updatedAt ?? '');
      groups.push({
        artist,
        sections,
        latestUpdatedAtMs: Number.isFinite(latestUpdatedAtMs) ? latestUpdatedAtMs : 0
      });
    }

    return groups.sort((left, right) => {
      if (right.latestUpdatedAtMs !== left.latestUpdatedAtMs) {
        return right.latestUpdatedAtMs - left.latestUpdatedAtMs;
      }
      return left.artist.name.localeCompare(right.artist.name);
    });
  }, [artists, conversationsByArtist, unlockedArtistIds]);

  const openConversation = useCallback(
    (conversation: Conversation) => {
      const threadType = normalizeConversationThreadType(conversation.threadType);
      setActiveConversation(conversation.id);
      if (threadType === 'primary') {
        setModeSelectSessionHubConversation(conversation.artistId, conversation.id);
        router.push(`/mode-select/${conversation.artistId}`);
        return;
      }
      router.push(`/chat/${conversation.id}`);
    },
    [setActiveConversation, setModeSelectSessionHubConversation]
  );

  const startNewDiscussionForArtist = useCallback(
    (artistId: string) => {
      const nextConversation = createAndPromotePrimaryConversation(artistId, language);
      setModeSelectSessionHubConversation(artistId, nextConversation.id);
      setActiveConversation(nextConversation.id);
      router.push(`/mode-select/${artistId}`);
    },
    [createAndPromotePrimaryConversation, language, setActiveConversation, setModeSelectSessionHubConversation]
  );

  const renderConversationItem = useCallback(
    (conversation: Conversation) => {
      const mode = getModeById(conversation.modeId);
      const modeName = mode?.name ?? conversation.modeId;
      const modeEmoji = mode?.emoji ?? '💬';
      const preview = conversation.lastMessagePreview?.trim() || t('newConversation');
      const threadType = normalizeConversationThreadType(conversation.threadType);
      const conversationTitle =
        threadType === 'primary'
          ? t('primaryThreadTitle')
          : threadType === 'secondary'
            ? resolveArchivedThreadTitle(conversation.updatedAt)
            : modeName;
      const threadBadgeLabel =
        threadType === 'primary'
          ? t('historyThreadPrimaryBadge')
          : threadType === 'secondary'
            ? t('historyThreadSecondaryBadge')
            : t('historyThreadModeBadge');

      const threadBadgeStyle =
        threadType === 'primary'
          ? styles.threadBadgePrimary
          : threadType === 'secondary'
            ? styles.threadBadgeSecondary
            : styles.threadBadgeMode;

      return (
        <Pressable
          key={conversation.id}
          testID={`history-item-${conversation.id}`}
          style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          onPress={() => openConversation(conversation)}
          accessibilityRole="button"
          accessibilityLabel={`${conversationTitle} ${preview}`}
        >
          <View style={styles.modeRow}>
            <Text style={styles.modeEmoji}>{modeEmoji}</Text>
            <Text style={styles.modeName}>{conversationTitle}</Text>
            <View style={[styles.threadBadge, threadBadgeStyle]}>
              <Text style={styles.threadBadgeText}>{threadBadgeLabel}</Text>
            </View>
          </View>
          <Text style={styles.preview}>{truncate(preview, 60)}</Text>
          <Text style={styles.timestamp}>{formatDate(conversation.updatedAt)}</Text>
        </Pressable>
      );
    },
    [openConversation]
  );

  return (
    <View style={styles.screen} testID="history-screen">
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="history-back" />
        <View style={styles.headerWrap}>
          <Text style={styles.subtitle}>{t('historyScreenTitle')}</Text>
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {!hasHydrated ? (
          <View style={styles.skeletonList}>
            {Array.from({ length: 4 }).map((_, index) => (
              <View key={`history-skeleton-${index}`} style={styles.skeletonCard}>
                <View style={styles.skeletonHeader} />
                <View style={styles.skeletonLine} />
                <View style={styles.skeletonTimestamp} />
              </View>
            ))}
          </View>
        ) : artistGroups.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🗂️</Text>
            <Text style={styles.emptyTitle}>{t('historyEmptyHeadline')}</Text>
            <Text style={styles.emptyText}>{t('historyEmptySubtext')}</Text>
          </View>
        ) : (
          artistGroups.map((group) => (
            <View key={group.artist.id} style={styles.artistSection} testID={`history-artist-section-${group.artist.id}`}>
              <View style={styles.artistHeaderRow}>
                <Text style={styles.artistTitle}>{group.artist.name}</Text>
                <Pressable
                  testID={`history-new-discussion-button-${group.artist.id}`}
                  style={({ pressed }) => [styles.newDiscussionButton, pressed ? styles.newDiscussionButtonPressed : null]}
                  onPress={() => startNewDiscussionForArtist(group.artist.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t('newDiscussionCta')}
                >
                  <Text style={styles.newDiscussionButtonText}>{t('newDiscussionCta')}</Text>
                </Pressable>
              </View>

              {group.sections.map((section) => (
                <View key={`${group.artist.id}-${section.title}`} style={styles.timeGroup}>
                  <Text style={styles.sectionHeader}>{section.title}</Text>
                  <View style={styles.itemsWrap}>
                    {section.data.map((conversation, index) => (
                      <View key={conversation.id}>
                        {renderConversationItem(conversation)}
                        {index < section.data.length - 1 ? <View style={styles.separator} /> : null}
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>
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
    maxWidth: 640,
    alignSelf: 'center'
  },
  listContent: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xl * 2,
    gap: theme.spacing.md
  },
  artistSection: {
    gap: theme.spacing.xs
  },
  artistHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm
  },
  artistTitle: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700'
  },
  newDiscussionButton: {
    borderWidth: 1,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceSunken,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6
  },
  newDiscussionButtonPressed: {
    opacity: 0.94
  },
  newDiscussionButtonText: {
    color: theme.colors.neonBlue,
    fontSize: 12,
    fontWeight: '700'
  },
  timeGroup: {
    gap: theme.spacing.xs
  },
  sectionHeader: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: theme.spacing.xs
  },
  itemsWrap: {
    gap: 0
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
  threadBadge: {
    marginLeft: 'auto',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1
  },
  threadBadgePrimary: {
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: 'rgba(45, 156, 255, 0.12)'
  },
  threadBadgeSecondary: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken
  },
  threadBadgeMode: {
    borderColor: theme.colors.neonRedSoft,
    backgroundColor: 'rgba(255, 99, 132, 0.12)'
  },
  threadBadgeText: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700'
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
  separator: {
    height: theme.spacing.sm
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
  }
});
