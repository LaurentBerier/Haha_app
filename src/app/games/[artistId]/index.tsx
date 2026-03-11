import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BackButton } from '../../../components/common/BackButton';
import { GAME_TYPE_CONFIGS } from '../../../games/types';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { t } from '../../../i18n';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';

export default function GamesScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';
  const headerHorizontalInset = useHeaderHorizontalInset();
  const artists = useStore((state) => state.artists);
  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);

  if (!artist) {
    return (
      <View style={styles.center} testID="games-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  const entries = Object.values(GAME_TYPE_CONFIGS).filter((item) => item.available);

  return (
    <View style={styles.screen}>
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="games-back" />
      </View>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll} testID="games-screen">
        <Text style={styles.title}>{t('gamesSection')}</Text>
        <Text style={styles.subtitle}>{t('gamesSectionSubtitle')}</Text>
        <Text style={styles.artistName}>{artist.name}</Text>

        <View style={styles.list}>
          {entries.map((entry) => (
            <Pressable
              key={entry.id}
              onPress={() => router.push(`/games/${artist.id}/${entry.id}`)}
              style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
              accessibilityRole="button"
              testID={`games-card-${entry.id}`}
            >
              <Text style={styles.emoji}>{entry.emoji}</Text>
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle}>{t(entry.labelKey)}</Text>
                <Text style={styles.cardDescription}>{t(entry.descriptionKey)}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  topRow: {
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs
  },
  scroll: {
    flex: 1
  },
  content: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl * 2,
    gap: theme.spacing.sm
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '800'
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 13
  },
  artistName: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  list: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs
  },
  card: {
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 14,
    backgroundColor: theme.colors.artistBubble,
    padding: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm
  },
  cardPressed: {
    opacity: 0.94
  },
  emoji: {
    fontSize: 26
  },
  cardContent: {
    flex: 1,
    gap: 3
  },
  cardTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
  },
  cardDescription: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17
  },
  chevron: {
    color: theme.colors.textMuted,
    fontSize: 24
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  errorText: {
    color: theme.colors.error
  }
});
