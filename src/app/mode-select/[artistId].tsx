import { useLocalSearchParams, router } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { ModeCard } from '../../components/mode/ModeCard';
import { getModeById } from '../../config/modes';
import { t } from '../../i18n';
import type { Mode } from '../../models/Mode';
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

  const handleModeSelect = useCallback(
    (modeId: string) => {
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
    },
    [activeConversationId, artist.defaultLanguage, artist.id, conversations, createConversation, setActiveConversation]
  );

  const renderMode = useCallback(
    ({ item }: { item: Mode }) => <ModeCard mode={item} onPress={() => handleModeSelect(item.id)} />,
    [handleModeSelect]
  );

  return (
    <View style={styles.screen}>
      <FlatList
        testID="mode-select-screen"
        data={modeOptions}
        keyExtractor={(item) => item.id}
        renderItem={renderMode}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>{t('modeSelectTitle')}</Text>
            <Text style={styles.subtitle}>{artist.name}</Text>
          </View>
        }
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl * 2
  },
  header: {
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md
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
  separator: {
    height: theme.spacing.md
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
