import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { AmbientGlow } from '../../components/common/AmbientGlow';
import { MODE_IDS } from '../../config/constants';
import { ModeCard } from '../../components/mode/ModeCard';
import { getModeById } from '../../config/modes';
import { getLanguage, t } from '../../i18n';
import type { Mode } from '../../models/Mode';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';

function resolveConversationLanguage(artist: { supportedLanguages: string[]; defaultLanguage: string }): string {
  const appLanguage = getLanguage();
  if (artist.supportedLanguages.includes(appLanguage)) {
    return appLanguage;
  }

  const languagePrefix = appLanguage.toLowerCase().split('-')[0];
  const familyMatch = artist.supportedLanguages.find((language) =>
    language.toLowerCase().startsWith(languagePrefix ?? '')
  );

  return familyMatch ?? artist.defaultLanguage;
}

export default function ModeSelectScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';

  const artists = useStore((state) => state.artists);
  const createConversation = useStore((state) => state.createConversation);
  const setActiveConversation = useStore((state) => state.setActiveConversation);

  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);

  const modeOptions = useMemo(() => {
    if (!artist) {
      return [];
    }

    const radarMode = getModeById(MODE_IDS.RADAR_ATTITUDE);
    const supported = artist.supportedModeIds
      .map((modeId) => getModeById(modeId))
      .filter((mode): mode is Mode => mode !== null);

    const base = radarMode ? [radarMode, ...supported] : supported;
    const historyMode: Mode = {
      id: MODE_IDS.HISTORY,
      name: t('historyModeTitle'),
      description: t('historyModeDescription'),
      emoji: '🕐',
      kind: MODE_IDS.HISTORY
    };

    return [...base, historyMode];
  }, [artist, t]);

  if (!artist) {
    return (
      <View style={styles.center} testID="mode-select-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  const handleModeSelect = useCallback(
    (modeId: string) => {
      if (modeId === MODE_IDS.HISTORY) {
        router.push(`/history/${artist.id}`);
        return;
      }

      const nextConversation = createConversation(artist.id, resolveConversationLanguage(artist), modeId);
      setActiveConversation(nextConversation.id);
      router.push(`/chat/${nextConversation.id}`);
    },
    [artist, createConversation, setActiveConversation]
  );

  const renderMode = useCallback(
    ({ item }: { item: Mode }) => <ModeCard mode={item} onPress={() => handleModeSelect(item.id)} />,
    [handleModeSelect]
  );

  return (
    <View style={styles.screen}>
      <AmbientGlow variant="mode" />
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
        style={styles.list}
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
  list: {
    backgroundColor: 'transparent'
  },
  content: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl * 2
  },
  header: {
    gap: 2,
    marginBottom: theme.spacing.sm,
    paddingHorizontal: 2
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 21,
    fontWeight: '700'
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 12
  },
  separator: {
    height: theme.spacing.sm
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
