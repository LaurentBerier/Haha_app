import { useIsFocused } from '@react-navigation/core';
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AmbientGlow } from '../../../components/common/AmbientGlow';
import { ModeTopChipHeader } from '../../../components/common/ModeTopChipHeader';
import { GameCard } from '../../../components/games/GameCard';
import { VISIBLE_GAME_IDS } from '../../../config/experienceCatalog';
import { MODE_CATEGORY_META } from '../../../config/modeCategories';
import { GAME_TYPE_CONFIGS } from '../../../games/types';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { t } from '../../../i18n';
import { launchVisibleGameRoute } from '../../../services/experienceLaunchService';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';

export default function GamesScreen() {
  const isFocused = useIsFocused();
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

  const entries = GAME_TYPE_CONFIGS.filter((item) => item.available && VISIBLE_GAME_IDS.includes(item.id));

  return (
    <View style={styles.screen}>
      <AmbientGlow variant="mode" isActive={isFocused} />
      <ModeTopChipHeader
        title={t('gameSelectTitle')}
        subtitle={t('gamesSectionSubtitle')}
        iconSource={MODE_CATEGORY_META.battles.icon}
        horizontalInset={headerHorizontalInset}
        backTestID="games-back"
        chipTestID="games-mode-chip"
      />
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll} testID="games-screen">
        <Text style={styles.artistName}>{artist.name}</Text>

        <View style={styles.list}>
          {entries.map((entry) => (
            <GameCard
              key={entry.id}
              emoji={entry.emoji}
              title={t(entry.labelKey)}
              description={t(entry.descriptionKey)}
              onPress={() => launchVisibleGameRoute(artist.id, entry.id)}
              testID={`games-card-${entry.id}`}
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
