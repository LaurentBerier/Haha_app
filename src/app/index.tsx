import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArtistCard } from '../components/artist/ArtistCard';
import { AmbientGlow } from '../components/common/AmbientGlow';
import { useArtist } from '../hooks/useArtist';
import { t } from '../i18n';
import { theme } from '../theme';

export default function HomeScreen() {
  const { artists, selectArtist, isArtistUnlocked } = useArtist();

  const handleStart = (artistId: string) => {
    selectArtist(artistId);
    router.push({
      pathname: '/mode-select/[artistId]',
      params: { artistId }
    });
  };

  return (
    <View style={styles.screen}>
      <AmbientGlow variant="home" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="home-screen">
        <View style={styles.topBar}>
          <Pressable style={styles.settingsButton} onPress={() => router.push('/settings')}>
            <Text style={styles.settingsButtonLabel}>{t('settingsTitle')}</Text>
          </Pressable>
        </View>
        <View style={styles.list}>
          {artists.map((artist) => (
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
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    justifyContent: 'flex-start'
  },
  topBar: {
    alignItems: 'flex-end',
    marginBottom: theme.spacing.md
  },
  settingsButton: {
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm
  },
  settingsButtonLabel: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700'
  },
  list: {
    gap: theme.spacing.md,
    alignItems: 'stretch'
  }
});
