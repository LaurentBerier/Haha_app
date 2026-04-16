import { useIsFocused } from '@react-navigation/core';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArtistCard } from '../components/artist/ArtistCard';
import { AmbientGlow } from '../components/common/AmbientGlow';
import { useArtist } from '../hooks/useArtist';
import { t } from '../i18n';
import { theme } from '../theme';

export default function HomeScreen() {
  const isFocused = useIsFocused();
  const { artists, selectArtist, isArtistUnlocked } = useArtist();
  const isLoadingArtists = artists.length === 0;
  const unlockedArtistsCount = useMemo(
    () => artists.filter((artist) => isArtistUnlocked(artist.id)).length,
    [artists, isArtistUnlocked]
  );
  const showAllLockedState = !isLoadingArtists && unlockedArtistsCount === 0;

  const handleStart = (artistId: string) => {
    selectArtist(artistId);
    router.push({
      pathname: '/mode-select/[artistId]',
      params: { artistId }
    });
  };

  return (
    <View style={styles.screen}>
      <AmbientGlow variant="home" isActive={isFocused} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="home-screen">
        <View style={styles.list}>
          {showAllLockedState ? (
            <View style={styles.emptyStateCard}>
              <Text style={styles.emptyStateEmoji}>🎟️</Text>
              <Text style={styles.emptyStateTitle}>{t('homeLockedHeadline')}</Text>
              <Text style={styles.emptyStateSubtitle}>{t('homeLockedSubtext')}</Text>
            </View>
          ) : null}
          {isLoadingArtists
            ? Array.from({ length: 3 }).map((_, index) => (
                <View key={`artist-skeleton-${index}`} style={styles.skeletonCard}>
                  <View style={styles.skeletonAvatar} />
                  <View style={styles.skeletonTitle} />
                  <View style={styles.skeletonSubtitle} />
                </View>
              ))
            : artists.map((artist) => (
                <ArtistCard
                  key={artist.id}
                  artist={artist}
                  locked={!isArtistUnlocked(artist.id)}
                  onStart={() => handleStart(artist.id)}
                />
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
  scroll: {
    flex: 1,
    backgroundColor: 'transparent'
  },
  content: {
    minHeight: '100%',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
    justifyContent: 'flex-start'
  },
  list: {
    width: '100%',
    maxWidth: 608,
    alignSelf: 'center',
    gap: theme.spacing.md,
    alignItems: 'stretch'
  },
  skeletonCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
    alignItems: 'center',
    gap: theme.spacing.sm
  },
  skeletonAvatar: {
    width: 116,
    height: 116,
    borderRadius: 58,
    backgroundColor: theme.colors.surfaceSunken
  },
  skeletonTitle: {
    width: '52%',
    height: 18,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceButton
  },
  skeletonSubtitle: {
    width: '70%',
    height: 12,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceSunken
  },
  emptyStateCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    alignItems: 'center',
    gap: theme.spacing.xs
  },
  emptyStateEmoji: {
    fontSize: 24
  },
  emptyStateTitle: {
    color: theme.colors.textPrimary,
    fontWeight: '700',
    fontSize: 16,
    textAlign: 'center'
  },
  emptyStateSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 13,
    textAlign: 'center'
  }
});
