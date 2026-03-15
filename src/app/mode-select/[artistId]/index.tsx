import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AmbientGlow } from '../../../components/common/AmbientGlow';
import { BackButton } from '../../../components/common/BackButton';
import { MODE_CATEGORY_META, MODE_CATEGORY_ORDER, type ModeCategoryId } from '../../../config/modeCategories';
import { API_BASE_URL, CLAUDE_PROXY_URL, E2E_AUTH_BYPASS } from '../../../config/env';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { useAudioPlayer } from '../../../hooks/useAudioPlayer';
import { t } from '../../../i18n';
import { synthesizeVoice } from '../../../services/voiceEngine';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';

interface GreetingCoordinates {
  lat: number;
  lon: number;
}

interface GreetingEndpointResponse {
  greeting?: unknown;
}

interface OptionalLocationModule {
  Accuracy?: {
    Balanced?: number;
    Low?: number;
    Lowest?: number;
  };
  getForegroundPermissionsAsync: () => Promise<{ granted?: boolean; status?: string }>;
  getCurrentPositionAsync: (options?: {
    accuracy?: number;
    maximumAge?: number;
    timeout?: number;
  }) => Promise<{ coords?: { latitude?: number; longitude?: number } }>;
}

let cachedLocationModule: OptionalLocationModule | null | undefined;

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function buildGreetingEndpointCandidates(): string[] {
  const isWebRuntime = typeof window !== 'undefined';
  const candidates: string[] = [];
  const addCandidate = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized) {
      return;
    }
    if (!isWebRuntime && normalized.startsWith('/')) {
      return;
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  const apiBase = normalizeUrl(API_BASE_URL);
  if (apiBase) {
    addCandidate(`${apiBase}/greeting`);
  }

  const claudeProxy = normalizeUrl(CLAUDE_PROXY_URL);
  if (claudeProxy) {
    addCandidate(claudeProxy.replace(/\/claude$/, '/greeting'));
  }

  if (isWebRuntime && typeof window.location?.origin === 'string' && window.location.origin) {
    const origin = normalizeUrl(window.location.origin);
    if (origin) {
      addCandidate(`${origin}/api/greeting`);
    }
    addCandidate('/api/greeting');
  }
  return candidates;
}

async function getOptionalCoords(): Promise<GreetingCoordinates | null> {
  if (Platform.OS === 'web') {
    return null;
  }

  if (cachedLocationModule === undefined) {
    try {
      const loaded = await import('expo-location');
      cachedLocationModule = loaded as OptionalLocationModule;
    } catch {
      cachedLocationModule = null;
    }
  }

  const locationModule = cachedLocationModule;
  if (!locationModule) {
    return null;
  }

  try {
    const permission = await locationModule.getForegroundPermissionsAsync();
    if (!permission.granted) {
      return null;
    }

    const accuracy =
      locationModule.Accuracy?.Balanced ?? locationModule.Accuracy?.Low ?? locationModule.Accuracy?.Lowest;

    const position = await locationModule.getCurrentPositionAsync({
      ...(typeof accuracy === 'number' ? { accuracy } : {}),
      maximumAge: 60_000,
      timeout: 5_000
    });

    const latitude = position.coords?.latitude;
    const longitude = position.coords?.longitude;
    if (
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude)
    ) {
      return null;
    }

    return { lat: latitude, lon: longitude };
  } catch {
    return null;
  }
}

async function fetchGreetingFromApi(
  artistId: string,
  language: string,
  accessToken: string,
  coords: GreetingCoordinates | null
): Promise<string | null> {
  const token = accessToken.trim();
  if (!token) {
    return null;
  }

  const payload: Record<string, unknown> = { artistId, language };
  if (coords) {
    payload.coords = coords;
  }

  const candidates = buildGreetingEndpointCandidates();
  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        continue;
      }

      const data = (await response.json()) as GreetingEndpointResponse;
      const greeting = typeof data.greeting === 'string' ? data.greeting.trim() : '';
      if (greeting) {
        return greeting;
      }
    } catch {
      // Try next endpoint candidate.
    }
  }

  return null;
}

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
      useNativeDriver: false
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 7,
      tension: 120,
      useNativeDriver: false
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
      testID={`mode-category-container-${id}`}
    >
      <Pressable
        testID={`mode-category-${id}`}
        style={({ pressed }) => [
          styles.categoryPressable,
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
  const [greeting, setGreeting] = useState<string | null>(null);

  const artists = useStore((state) => state.artists);
  const language = useStore((state) => state.language);
  const accessToken = useStore((state) => state.session?.accessToken ?? '');
  const greetedArtistIds = useStore((state) => state.greetedArtistIds);
  const markArtistGreeted = useStore((state) => state.markArtistGreeted);
  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);
  const audioPlayer = useAudioPlayer();
  const playGreetingAudio = audioPlayer.play;
  const pendingGreetingArtistIdRef = useRef<string | null>(null);
  const greetingPlaybackStartedRef = useRef(false);

  useEffect(() => {
    if (E2E_AUTH_BYPASS) {
      return;
    }

    if (!artist || greetedArtistIds.has(artist.id)) {
      return;
    }

    let isCancelled = false;
    const runGreeting = async () => {
      const coords = await getOptionalCoords();
      if (isCancelled) {
        return;
      }

      const nextGreeting = await fetchGreetingFromApi(artist.id, language, accessToken, coords);
      if (isCancelled || !nextGreeting) {
        return;
      }

      setGreeting(nextGreeting);

      if (!accessToken.trim()) {
        markArtistGreeted(artist.id);
        return;
      }

      try {
        const greetingAudioUri = await synthesizeVoice(nextGreeting, artist.id, language, accessToken);
        if (isCancelled) {
          return;
        }

        pendingGreetingArtistIdRef.current = artist.id;
        greetingPlaybackStartedRef.current = false;
        await playGreetingAudio(greetingAudioUri);
      } catch {
        if (!isCancelled) {
          markArtistGreeted(artist.id);
        }
      }
    };

    void runGreeting();
    return () => {
      isCancelled = true;
    };
  }, [accessToken, artist, greetedArtistIds, language, markArtistGreeted, playGreetingAudio]);

  useEffect(() => {
    const pendingArtistId = pendingGreetingArtistIdRef.current;
    if (!pendingArtistId) {
      return;
    }

    if (audioPlayer.isPlaying) {
      greetingPlaybackStartedRef.current = true;
      return;
    }

    if (!greetingPlaybackStartedRef.current || audioPlayer.isLoading) {
      return;
    }

    markArtistGreeted(pendingArtistId);
    pendingGreetingArtistIdRef.current = null;
    greetingPlaybackStartedRef.current = false;
  }, [audioPlayer.isLoading, audioPlayer.isPlaying, markArtistGreeted]);

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
        {greeting ? (
          <View style={styles.greetingCard}>
            <Text style={styles.greetingText}>{greeting}</Text>
          </View>
        ) : null}

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
  greetingCard: {
    marginBottom: theme.spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm
  },
  greetingText: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 20
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
