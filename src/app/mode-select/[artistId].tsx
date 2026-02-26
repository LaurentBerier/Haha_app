import { useLocalSearchParams, router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ModeCard } from '../../components/mode/ModeCard';
import { getModeById } from '../../config/modes';
import { t } from '../../i18n';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';

export default function ModeSelectScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';

  const artists = useStore((state) => state.artists);
  const conversations = useStore((state) => state.conversations);
  const activeConversationId = useStore((state) => state.activeConversationId);
  const createConversation = useStore((state) => state.createConversation);
  const setActiveConversation = useStore((state) => state.setActiveConversation);

  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);

  const modeOptions = useMemo(() => {
    if (!artist) {
      return [];
    }

    const radarMode = getModeById('radar-attitude');
    const supported = artist.supportedModeIds
      .map((modeId) => getModeById(modeId))
      .filter((mode): mode is NonNullable<typeof mode> => mode !== null);

    return radarMode ? [radarMode, ...supported] : supported;
  }, [artist]);

  if (!artist) {
    return (
      <View style={styles.center} testID="mode-select-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  const handleModeSelect = (modeId: string) => {
    const hasActiveForMode =
      !!activeConversationId &&
      (conversations[artist.id] ?? []).some(
        (conversation) => conversation.id === activeConversationId && conversation.modeId === modeId
      );

    if (hasActiveForMode && activeConversationId) {
      setActiveConversation(activeConversationId);
      router.push(`/chat/${activeConversationId}`);
      return;
    }

    const nextConversation = createConversation(artist.id, artist.defaultLanguage, modeId);
    setActiveConversation(nextConversation.id);
    router.push(`/chat/${nextConversation.id}`);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="mode-select-screen">
      <Text style={styles.title}>{t('modeSelectTitle')}</Text>
      <Text style={styles.subtitle}>{artist.name}</Text>
      <View style={styles.grid}>
        {modeOptions.map((mode) => (
          <ModeCard key={mode.id} mode={mode} onPress={() => handleModeSelect(mode.id)} />
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
  title: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '700'
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 14
  },
  grid: {
    gap: theme.spacing.md
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background
  },
  errorText: {
    color: theme.colors.error
  }
});
