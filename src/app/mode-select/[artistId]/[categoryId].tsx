import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AmbientGlow } from '../../../components/common/AmbientGlow';
import { ModeTopChipHeader } from '../../../components/common/ModeTopChipHeader';
import { ModeCard } from '../../../components/mode/ModeCard';
import { MODE_IDS } from '../../../config/constants';
import { VISIBLE_GAME_IDS } from '../../../config/experienceCatalog';
import { EXPENSIVE_GAME_IDS, EXPENSIVE_MODE_IDS } from '../../../config/quotaGating';
import { CATEGORY_MODE_IDS, MODE_CATEGORY_META, isModeCategoryId } from '../../../config/modeCategories';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { getModeById } from '../../../config/modes';
import { t } from '../../../i18n';
import { GAME_TYPE_CONFIGS } from '../../../games/types';
import type { Mode } from '../../../models/Mode';
import { launchVisibleGameRoute, launchVisibleModeConversation } from '../../../services/experienceLaunchService';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';

export default function ModeCategoryScreen() {
  const params = useLocalSearchParams<{ artistId: string; categoryId: string }>();
  const artistId = params.artistId ?? '';
  const categoryIdParam = params.categoryId ?? '';
  const headerHorizontalInset = useHeaderHorizontalInset();

  const artists = useStore((state) => state.artists);
  const language = useStore((state) => state.language);
  const isExpensiveModeAvailable = useStore((state) => state.isExpensiveModeAvailable());

  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);
  const categoryId = isModeCategoryId(categoryIdParam) ? categoryIdParam : null;

  useEffect(() => {
    if (categoryIdParam === 'profile') {
      router.replace('/settings');
    }
  }, [categoryIdParam]);

  const categoryTitle = categoryId ? t(MODE_CATEGORY_META[categoryId].labelKey) : t('modeSelectTitle');

  const availableModes = useMemo(() => {
    if (!artist || !categoryId || categoryId === 'profile') {
      return [] as Mode[];
    }

    const supported = [MODE_IDS.ON_JASE, ...artist.supportedModeIds]
      .map((modeId) => getModeById(modeId))
      .filter((mode): mode is Mode => mode !== null);

    const byId = supported.reduce<Record<string, Mode>>((acc, mode) => {
      acc[mode.id] = mode;
      return acc;
    }, {});

    return CATEGORY_MODE_IDS[categoryId].map((modeId) => byId[modeId]).filter((mode): mode is Mode => Boolean(mode));
  }, [artist, categoryId]);

  const availableGames = useMemo(
    () =>
      GAME_TYPE_CONFIGS.filter((gameType) => gameType.available && VISIBLE_GAME_IDS.includes(gameType.id)).map((gameType) => ({
        id: gameType.id,
        name: t(gameType.labelKey),
        description: t(gameType.descriptionKey),
        emoji: gameType.emoji,
        kind: 'battle' as const
      })),
    []
  );

  const handleModeSelect = useCallback(
    (modeId: string) => {
      if (!artist) {
        return;
      }
      launchVisibleModeConversation({
        artistId: artist.id,
        modeId,
        fallbackLanguage: language
      });
    },
    [artist, language]
  );

  if (!artist || !categoryId) {
    return (
      <View style={styles.center} testID="mode-category-invalid">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <AmbientGlow variant="mode" />
      <ModeTopChipHeader
        title={categoryTitle}
        subtitle={artist.name}
        iconSource={MODE_CATEGORY_META[categoryId].icon}
        horizontalInset={headerHorizontalInset}
        backTestID="mode-category-back"
        chipTestID="mode-category-chip"
      />
      <ScrollView testID="mode-category-screen" style={styles.list} contentContainerStyle={styles.content}>
        {categoryId === 'profile' ? (
          <View style={styles.profileActionGroup}>
            <View style={styles.profileActionCard}>
              <Text style={styles.profileActionTitle}>{t('settingsEditProfile')}</Text>
              <Text style={styles.profileActionDescription}>{t('modeProfileEditDescription')}</Text>
              <Pressable
                onPress={() => router.push('/settings/edit-profile')}
                style={({ pressed }) => [
                  styles.profileActionButton,
                  pressed ? styles.profileActionButtonPressed : null
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.profileActionLink}>{t('settingsEditProfile')}</Text>
              </Pressable>
            </View>
            <View style={styles.profileActionCard}>
              <Text style={styles.profileActionTitle}>{t('historyModeTitle')}</Text>
              <Text style={styles.profileActionDescription}>{t('historyModeDescription')}</Text>
              <Pressable
                onPress={() => router.push('/history')}
                style={({ pressed }) => [
                  styles.profileActionButton,
                  pressed ? styles.profileActionButtonPressed : null
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.profileActionLink}>{t('historyScreenTitle')}</Text>
              </Pressable>
            </View>
          </View>
        ) : categoryId === 'battles' ? (
          <View style={styles.modeList}>
            {availableGames.map((gameMode) => (
              <ModeCard
                key={gameMode.id}
                mode={gameMode}
                disabled={!isExpensiveModeAvailable && EXPENSIVE_GAME_IDS.has(gameMode.id)}
                onPress={() => launchVisibleGameRoute(artist.id, gameMode.id)}
              />
            ))}
          </View>
        ) : availableModes.length > 0 ? (
          <View style={styles.modeList}>
            {availableModes.map((mode) => (
              <ModeCard
                key={mode.id}
                mode={mode}
                disabled={!isExpensiveModeAvailable && EXPENSIVE_MODE_IDS.has(mode.id)}
                onPress={() => handleModeSelect(mode.id)}
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🎭</Text>
            <Text style={styles.emptyTitle}>{t('modeSelectCategoryEmptyTitle')}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  list: {
    backgroundColor: 'transparent',
    flex: 1
  },
  content: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl * 2,
    width: '100%',
    maxWidth: 608,
    alignSelf: 'center'
  },
  modeList: {
    gap: theme.spacing.sm
  },
  profileActionGroup: {
    gap: theme.spacing.sm
  },
  profileActionCard: {
    borderWidth: 1.5,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceRaised,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm
  },
  profileActionTitle: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  },
  profileActionDescription: {
    marginTop: 4,
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 16
  },
  profileActionLink: {
    color: theme.colors.neonBlue,
    fontSize: 13,
    fontWeight: '700'
  },
  profileActionButton: {
    marginTop: theme.spacing.sm,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6
  },
  profileActionButtonHover: {
    borderColor: theme.colors.neonBlue,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4
  },
  profileActionButtonPressed: {
    opacity: 0.94
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background
  },
  errorText: {
    color: theme.colors.error
  },
  emptyState: {
    marginTop: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    alignItems: 'center',
    gap: theme.spacing.xs
  },
  emptyEmoji: {
    fontSize: 24
  },
  emptyTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center'
  }
});
