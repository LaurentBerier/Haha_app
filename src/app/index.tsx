import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ArtistCard } from '../components/artist/ArtistCard';
import { Header } from '../components/common/Header';
import { useArtist } from '../hooks/useArtist';
import { t } from '../i18n';
import { theme } from '../theme';

export default function HomeScreen() {
  const { artists, selectArtist, isArtistUnlocked } = useArtist();
  const orderedArtists = useMemo(() => artists, [artists]);

  const handleStart = (artistId: string) => {
    selectArtist(artistId);
    router.push(`/mode-select/${artistId}` as never);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="home-screen">
      <Header title={t('homeTitle')} subtitle={t('appName')} />
      <View style={styles.list}>
        {orderedArtists.map((artist) => (
          <ArtistCard
            key={artist.id}
            artist={artist}
            locked={!isArtistUnlocked(artist.id)}
            onStart={() => handleStart(artist.id)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md
  },
  list: {
    gap: theme.spacing.md
  }
});
