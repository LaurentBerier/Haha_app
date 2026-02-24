import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ArtistCard } from '../components/artist/ArtistCard';
import { Header } from '../components/common/Header';
import { t } from '../i18n';
import { useArtist } from '../hooks/useArtist';
import { useStore } from '../store/useStore';
import { theme } from '../theme';

export default function HomeScreen() {
  const { artists, selectArtist, isArtistUnlocked } = useArtist();
  const createConversation = useStore((state) => state.createConversation);
  const setActiveConversation = useStore((state) => state.setActiveConversation);
  const activeConversationId = useStore((state) => state.activeConversationId);
  const conversations = useStore((state) => state.conversations);

  const orderedArtists = useMemo(() => artists, [artists]);

  const handleStart = (artistId: string, language: string) => {
    selectArtist(artistId);
    const hasActiveForArtist =
      !!activeConversationId &&
      (conversations[artistId] ?? []).some((conversation) => conversation.id === activeConversationId);

    if (hasActiveForArtist && activeConversationId) {
      setActiveConversation(activeConversationId);
      router.push(`/chat/${activeConversationId}`);
      return;
    }

    const nextConversation = createConversation(artistId, language);
    setActiveConversation(nextConversation.id);
    router.push(`/chat/${nextConversation.id}`);
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
            onStart={() => handleStart(artist.id, artist.defaultLanguage)}
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
