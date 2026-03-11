import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AmbientGlow } from '../../../components/common/AmbientGlow';
import { BackButton } from '../../../components/common/BackButton';
import { MODE_CATEGORY_META, MODE_CATEGORY_ORDER, type ModeCategoryId } from '../../../config/modeCategories';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { t } from '../../../i18n';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';

interface CategoryMenuButtonProps {
  artistId: string;
  id: ModeCategoryId;
  index: number;
}

function CategoryMenuButton({ artistId, id, index }: CategoryMenuButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.delay(index * 120),
        Animated.timing(glow, {
          toValue: 1,
          duration: 950,
          useNativeDriver: false
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 950,
          useNativeDriver: false
        })
      ])
    );
    breathing.start();
    return () => breathing.stop();
  }, [glow, index]);

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.96,
      friction: 8,
      tension: 180,
      useNativeDriver: true
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 7,
      tension: 120,
      useNativeDriver: true
    }).start();
  };

  const backgroundColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.surface, theme.colors.surfaceRaised]
  });

  const shadowOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.14, 0.34]
  });

  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.border, theme.colors.neonBlue]
  });

  return (
    <Animated.View
      style={[
        styles.categoryCard,
        {
          transform: [{ scale }],
          backgroundColor,
          shadowOpacity,
          borderColor
        }
      ]}
      testID={`mode-category-${id}`}
    >
      <Pressable
        style={({ hovered, pressed }) => [
          styles.categoryPressable,
          hovered ? styles.categoryPressableHover : null,
          pressed ? styles.categoryPressablePressed : null
        ]}
        onPress={() => router.push(`/mode-select/${artistId}/${id}`)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
      >
        <Text style={styles.categoryEmoji}>{MODE_CATEGORY_META[id].emoji}</Text>
        <Text style={styles.categoryLabel}>{t(MODE_CATEGORY_META[id].labelKey)}</Text>
      </Pressable>
    </Animated.View>
  );
}

export default function ModeSelectHomeScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';
  const headerHorizontalInset = useHeaderHorizontalInset();

  const artists = useStore((state) => state.artists);
  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);

  if (!artist) {
    return (
      <View style={styles.center} testID="mode-select-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <AmbientGlow variant="mode" />
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="mode-select-back" />
      </View>
      <ScrollView testID="mode-select-screen" style={styles.list} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.subtitle}>{artist.name}</Text>
          <Text style={styles.helperText}>{t('modeSelectCategoryEmptySubtitle')}</Text>
        </View>

        <View style={styles.categoryGrid}>
          {MODE_CATEGORY_ORDER.map((categoryId, index) => (
            <CategoryMenuButton key={categoryId} artistId={artist.id} id={categoryId} index={index} />
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
  list: {
    backgroundColor: 'transparent',
    flex: 1
  },
  topRow: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs
  },
  content: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl * 2,
    width: '100%',
    maxWidth: 608,
    alignSelf: 'center'
  },
  header: {
    gap: 4,
    marginBottom: theme.spacing.md,
    paddingHorizontal: 2
  },
  subtitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700'
  },
  helperText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 16
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing.sm
  },
  categoryCard: {
    width: '48.5%',
    minHeight: 118,
    borderWidth: 1.7,
    borderRadius: 16,
    shadowColor: theme.colors.neonBlue,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4
  },
  categoryPressable: {
    flex: 1,
    minHeight: 118,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm
  },
  categoryPressableHover: {
    backgroundColor: theme.colors.surfaceRaised
  },
  categoryPressablePressed: {
    opacity: 0.96
  },
  categoryEmoji: {
    fontSize: 36
  },
  categoryLabel: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center'
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
