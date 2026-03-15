import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AmbientGlow } from '../../../components/common/AmbientGlow';
import { BackButton } from '../../../components/common/BackButton';
import { MODE_IDS } from '../../../config/constants';
import { MODE_CATEGORY_META, MODE_CATEGORY_ORDER, type ModeCategoryId } from '../../../config/modeCategories';
import { getModeById } from '../../../config/modes';
import { API_BASE_URL, CLAUDE_PROXY_URL, E2E_AUTH_BYPASS } from '../../../config/env';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { useAudioPlayer } from '../../../hooks/useAudioPlayer';
import { t } from '../../../i18n';
import { synthesizeVoice } from '../../../services/voiceEngine';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';
import { generateId } from '../../../utils/generateId';

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
const MIN_GREETING_TYPING_INTERVAL_MS = 18;
const MAX_GREETING_TYPING_INTERVAL_MS = 80;
const DEFAULT_GREETING_TYPING_DURATION_MS = 4_200;

interface ArtistModeSource {
  name?: string;
  supportedModeIds?: string[];
  supportedLanguages?: string[];
  defaultLanguage?: string;
}

function toFirstName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const withoutEmailHost = trimmed.includes('@') ? trimmed.split('@')[0] ?? '' : trimmed;
  const firstToken = withoutEmailHost
    .split(/\s+/)
    .map((token) => token.trim())
    .find(Boolean);
  return firstToken ? firstToken.slice(0, 32) : null;
}

function resolveGreetingPreferredName(params: {
  profilePreferredName?: string | null;
  displayName?: string | null;
  email?: string | null;
}): string | null {
  return (
    toFirstName(params.profilePreferredName ?? null) ??
    toFirstName(params.displayName ?? null) ??
    toFirstName(params.email ?? null)
  );
}

function resolveGreetingConversationLanguage(artist: ArtistModeSource, preferredLanguage: string): string {
  const supportedLanguages = Array.isArray(artist.supportedLanguages) ? artist.supportedLanguages : [];
  if (supportedLanguages.includes(preferredLanguage)) {
    return preferredLanguage;
  }

  const preferredFamily = preferredLanguage.toLowerCase().split('-')[0];
  if (preferredFamily) {
    const familyMatch = supportedLanguages.find((candidate) => candidate.toLowerCase().startsWith(preferredFamily));
    if (familyMatch) {
      return familyMatch;
    }
  }

  return artist.defaultLanguage?.trim() || preferredLanguage;
}

function splitGreetingIntoBubbles(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  const chunks = normalized
    .split(/(?<=[.!?])\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.length > 0 ? chunks : [normalized];
}

function speakGreetingWithWebFallback(text: string, language: string): boolean {
  if (Platform.OS !== 'web') {
    return false;
  }

  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  const speechScope = globalThis as {
    speechSynthesis?: {
      cancel: () => void;
      speak: (utterance: unknown) => void;
      getVoices?: () => Array<{ lang?: string; name?: string }>;
    };
    SpeechSynthesisUtterance?: new (text: string) => {
      lang: string;
      rate: number;
      pitch: number;
      voice?: unknown;
    };
  };

  if (!speechScope.speechSynthesis || typeof speechScope.SpeechSynthesisUtterance !== 'function') {
    return false;
  }

  try {
    const synth = speechScope.speechSynthesis;
    const utterance = new speechScope.SpeechSynthesisUtterance(normalized);
    const targetLang = language.toLowerCase().startsWith('en') ? 'en' : 'fr';
    utterance.lang = targetLang === 'en' ? 'en-CA' : 'fr-CA';
    utterance.rate = 1;
    utterance.pitch = 1;

    const voices = synth.getVoices?.() ?? [];
    const matchingVoice = voices.find((voice) => voice.lang?.toLowerCase().startsWith(targetLang));
    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }

    synth.cancel();
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

function buildFallbackGreetingText(
  artist: ArtistModeSource,
  language: string,
  preferredName: string | null,
  _availableModes: string[],
  includeVoiceHint: boolean
): string {
  const isEnglish = language.toLowerCase().startsWith('en');
  const displayName = preferredName ?? (isEnglish ? 'there' : 'toi');
  const artistName = artist.name?.trim() || 'Cathy';
  const variationIndex = Math.floor(Math.random() * 3);

  if (isEnglish) {
    const openingVariants = [
      `Hey ${displayName}, how are you? It's ${artistName}, yes, the loud one.`,
      `Hi ${displayName}, how's it going? ${artistName} here, no need to pretend you're surprised.`,
      `Yo ${displayName}, how are you doing? It's ${artistName} on the mic, obviously.`
    ];
    const voiceSentenceVariants = includeVoiceHint
      ? [
          'Voice mode is already on, and you can turn it off with the little mic at the bottom right if you feel like typing.',
          'We are already in voice mode; tap the small mic at the bottom right anytime if you prefer writing.',
          'Conversation voice is active now, and the small mic at the bottom right lets you switch back to text whenever you want.'
        ]
      : ['Voice mode is already on.'];
    return [
      openingVariants[variationIndex] ?? openingVariants[0],
      voiceSentenceVariants[variationIndex] ?? voiceSentenceVariants[0]
    ]
      .filter(Boolean)
      .join(' ');
  }

  const openingVariants = [
    `Hey salut ${displayName}, comment tu vas? Moi c'est ${artistName}, j'imagine que tu l'avais déjà deviné.`,
    `Allô ${displayName}, ça va bien? ${artistName} au micro, grosse surprise, pas pantoute.`,
    `Salut ${displayName}, comment ça roule? Ici ${artistName}, ta notification la plus bavarde.`
  ];
  const voiceSentenceVariants = includeVoiceHint
    ? [
        'Le mode discussion vocale est déjà actif, et tu peux le couper avec le petit micro en bas à droite si tu préfères écrire.',
        "On est déjà en mode vocal; touche le petit micro en bas à droite quand tu veux revenir au clavier.",
        'La conversation vocale tourne déjà, et le petit micro en bas à droite te laisse repasser en mode texte quand tu veux.'
      ]
    : ['Le mode discussion vocale est déjà actif.'];

  return [
    openingVariants[variationIndex] ?? openingVariants[0],
    voiceSentenceVariants[variationIndex] ?? voiceSentenceVariants[0]
  ]
    .filter(Boolean)
    .join(' ');
}

function estimateGreetingSpeechDurationMs(text: string): number {
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (words <= 0) {
    return DEFAULT_GREETING_TYPING_DURATION_MS;
  }

  const estimated = Math.round((words / 2.7) * 1000);
  return Math.max(2_600, Math.min(estimated, 14_000));
}

function buildAvailableModesForGreeting(artist: ArtistModeSource): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  const modeIds = [MODE_IDS.ON_JASE, ...(artist.supportedModeIds ?? [])];

  modeIds.forEach((modeId) => {
    const modeName = getModeById(modeId)?.name?.trim();
    if (!modeName) {
      return;
    }

    const key = modeName.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    names.push(modeName);
  });

  return names.slice(0, 10);
}

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
  coords: GreetingCoordinates | null,
  availableModes: string[],
  preferredName: string | null,
  includeVoiceHint: boolean
): Promise<string | null> {
  const token = accessToken.trim();
  if (!token) {
    return null;
  }

  const payload: Record<string, unknown> = {
    artistId,
    language,
    availableModes,
    includeVoiceHint
  };
  if (preferredName) {
    payload.preferredName = preferredName;
  }
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
  const { height: viewportHeight } = useWindowDimensions();
  const headerHorizontalInset = useHeaderHorizontalInset();
  const [greeting, setGreeting] = useState<string | null>(null);
  const [typedGreeting, setTypedGreeting] = useState('');

  const artists = useStore((state) => state.artists);
  const language = useStore((state) => state.language);
  const accessToken = useStore((state) => state.session?.accessToken ?? '');
  const sessionUser = useStore((state) => state.session?.user ?? null);
  const userProfile = useStore((state) => state.userProfile);
  const createConversation = useStore((state) => state.createConversation);
  const setActiveConversation = useStore((state) => state.setActiveConversation);
  const setModeSelectGreetingAudioActive = useStore((state) => state.setModeSelectGreetingAudioActive);
  const addMessage = useStore((state) => state.addMessage);
  const updateConversation = useStore((state) => state.updateConversation);
  const markArtistGreeted = useStore((state) => state.markArtistGreeted);
  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);
  const preferredName = useMemo(
    () =>
      resolveGreetingPreferredName({
        profilePreferredName: userProfile?.preferredName ?? null,
        displayName: sessionUser?.displayName ?? null,
        email: sessionUser?.email ?? null
      }),
    [sessionUser?.displayName, sessionUser?.email, userProfile?.preferredName]
  );
  const audioPlayer = useAudioPlayer();
  const playGreetingAudio = audioPlayer.play;
  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const greetingPlaybackCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetingGestureRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetingSpeechHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioStateRef = useRef<{
    isPlaying: boolean;
    isLoading: boolean;
    currentUri: string | null;
  }>({
    isPlaying: false,
    isLoading: false,
    currentUri: null
  });
  const [pendingGreetingAudioUri, setPendingGreetingAudioUri] = useState<string | null>(null);
  const [pendingGreetingSpeechText, setPendingGreetingSpeechText] = useState<string | null>(null);
  const [isWebSpeechFallbackActive, setIsWebSpeechFallbackActive] = useState(false);
  const greetingBubbles = useMemo(
    () => splitGreetingIntoBubbles(typedGreeting),
    [typedGreeting]
  );
  const greetingOverlayMaxHeight = Math.max(190, Math.floor(viewportHeight * 0.48));
  const isGreetingVoicePendingGesture = Boolean(pendingGreetingAudioUri || pendingGreetingSpeechText);
  const isGreetingVoiceActive =
    greeting !== null && (audioPlayer.isLoading || audioPlayer.isPlaying || isGreetingVoicePendingGesture || isWebSpeechFallbackActive);
  const isGreetingSpeechOutputActive =
    greeting !== null && (audioPlayer.isLoading || audioPlayer.isPlaying || isWebSpeechFallbackActive);
  const greetingVoiceLabel = isGreetingVoicePendingGesture
    ? t('modeSelectGreetingTapToPlay')
    : t('modeSelectGreetingSpeaking');

  const clearTypingInterval = useCallback(() => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
  }, []);

  const clearGreetingPlaybackCheck = useCallback(() => {
    if (greetingPlaybackCheckTimeoutRef.current) {
      clearTimeout(greetingPlaybackCheckTimeoutRef.current);
      greetingPlaybackCheckTimeoutRef.current = null;
    }
  }, []);

  const clearGreetingGestureRetry = useCallback(() => {
    if (greetingGestureRetryTimeoutRef.current) {
      clearTimeout(greetingGestureRetryTimeoutRef.current);
      greetingGestureRetryTimeoutRef.current = null;
    }
  }, []);

  const clearGreetingSpeechHint = useCallback(() => {
    if (greetingSpeechHintTimeoutRef.current) {
      clearTimeout(greetingSpeechHintTimeoutRef.current);
      greetingSpeechHintTimeoutRef.current = null;
    }
    setIsWebSpeechFallbackActive(false);
  }, []);

  const pulseGreetingSpeechHint = useCallback((durationMs: number) => {
    clearGreetingSpeechHint();
    setIsWebSpeechFallbackActive(true);
    greetingSpeechHintTimeoutRef.current = setTimeout(() => {
      setIsWebSpeechFallbackActive(false);
      greetingSpeechHintTimeoutRef.current = null;
    }, Math.max(800, durationMs));
  }, [clearGreetingSpeechHint]);

  const startTypingGreeting = useCallback(
    (text: string, targetDurationMs: number) => {
      clearTypingInterval();
      const normalized = text.trim();
      if (!normalized) {
        setTypedGreeting('');
        return;
      }

      setTypedGreeting('');
      const totalChars = normalized.length;
      const intervalMs = Math.max(
        MIN_GREETING_TYPING_INTERVAL_MS,
        Math.min(MAX_GREETING_TYPING_INTERVAL_MS, Math.round(targetDurationMs / Math.max(totalChars, 1)))
      );
      let index = 0;

      typingIntervalRef.current = setInterval(() => {
        index += 1;
        if (index >= totalChars) {
          setTypedGreeting(normalized);
          clearTypingInterval();
          return;
        }

        setTypedGreeting(normalized.slice(0, index));
      }, intervalMs);
    },
    [clearTypingInterval]
  );

  useEffect(() => {
    setModeSelectGreetingAudioActive(isGreetingSpeechOutputActive);
    return () => {
      setModeSelectGreetingAudioActive(false);
    };
  }, [isGreetingSpeechOutputActive, setModeSelectGreetingAudioActive]);

  useEffect(() => {
    audioStateRef.current = {
      isPlaying: audioPlayer.isPlaying,
      isLoading: audioPlayer.isLoading,
      currentUri: audioPlayer.currentUri
    };
  }, [audioPlayer.currentUri, audioPlayer.isLoading, audioPlayer.isPlaying]);

  useEffect(() => {
    if (E2E_AUTH_BYPASS) {
      return;
    }

    if (!artist) {
      return;
    }

    const greetedArtistIds = useStore.getState().greetedArtistIds;
    if (greetedArtistIds.has(artist.id)) {
      return;
    }

    clearTypingInterval();
    clearGreetingPlaybackCheck();
    clearGreetingGestureRetry();
    clearGreetingSpeechHint();

    let isCancelled = false;
    const runGreeting = async () => {
      const sessionStateBeforeGreeting = useStore.getState();
      if (sessionStateBeforeGreeting.greetedArtistIds.has(artist.id)) {
        return;
      }
      const includeVoiceHint = sessionStateBeforeGreeting.greetedArtistIds.size === 0;
      markArtistGreeted(artist.id);
      const introConversation = createConversation(
        artist.id,
        resolveGreetingConversationLanguage(artist, language),
        MODE_IDS.ON_JASE
      );
      setActiveConversation(introConversation.id);

      const availableModes = buildAvailableModesForGreeting(artist);
      const coords = await getOptionalCoords();
      if (isCancelled) {
        return;
      }

      const fetchedGreeting = await fetchGreetingFromApi(
        artist.id,
        language,
        accessToken,
        coords,
        availableModes,
        preferredName,
        includeVoiceHint
      );
      const nextGreeting =
        fetchedGreeting ?? buildFallbackGreetingText(artist, language, preferredName, availableModes, includeVoiceHint);
      if (isCancelled || !nextGreeting) {
        return;
      }

      const now = new Date().toISOString();
      addMessage(introConversation.id, {
        id: generateId('msg'),
        conversationId: introConversation.id,
        role: 'artist',
        content: nextGreeting,
        status: 'complete',
        timestamp: now
      });
      updateConversation(
        introConversation.id,
        {
          lastMessagePreview: nextGreeting.slice(0, 120),
          title: nextGreeting.slice(0, 30)
        },
        artist.id
      );

      setGreeting(nextGreeting);
      setTypedGreeting('');
      setPendingGreetingAudioUri(null);
      setPendingGreetingSpeechText(null);
      clearGreetingSpeechHint();
      startTypingGreeting(nextGreeting, estimateGreetingSpeechDurationMs(nextGreeting));

      if (!accessToken.trim()) {
        if (Platform.OS === 'web') {
          if (!speakGreetingWithWebFallback(nextGreeting, language)) {
            setPendingGreetingSpeechText(nextGreeting);
          } else {
            pulseGreetingSpeechHint(estimateGreetingSpeechDurationMs(nextGreeting));
          }
        }
        return;
      }

      try {
        const greetingAudioUri = await synthesizeVoice(nextGreeting, artist.id, language, accessToken, {
          purpose: 'greeting'
        });
        if (isCancelled) {
          return;
        }

        void playGreetingAudio(greetingAudioUri);
        if (Platform.OS === 'web') {
          clearGreetingPlaybackCheck();
          greetingPlaybackCheckTimeoutRef.current = setTimeout(() => {
            const audioState = audioStateRef.current;
            if (audioState.isPlaying || audioState.isLoading || audioState.currentUri === greetingAudioUri) {
              return;
            }
            if (!speakGreetingWithWebFallback(nextGreeting, language)) {
              setPendingGreetingAudioUri(greetingAudioUri);
              setPendingGreetingSpeechText(nextGreeting);
            } else {
              pulseGreetingSpeechHint(estimateGreetingSpeechDurationMs(nextGreeting));
            }
          }, 900);
        }
      } catch {
        if (!isCancelled) {
          if (Platform.OS === 'web') {
            if (!speakGreetingWithWebFallback(nextGreeting, language)) {
              setPendingGreetingSpeechText(nextGreeting);
            } else {
              pulseGreetingSpeechHint(estimateGreetingSpeechDurationMs(nextGreeting));
            }
          }
        }
      }
    };

    void runGreeting();
    return () => {
      isCancelled = true;
    };
  }, [
    accessToken,
    addMessage,
    artist,
    clearGreetingGestureRetry,
    clearGreetingPlaybackCheck,
    clearGreetingSpeechHint,
    clearTypingInterval,
    createConversation,
    language,
    markArtistGreeted,
    preferredName,
    pulseGreetingSpeechHint,
    playGreetingAudio,
    setActiveConversation,
    startTypingGreeting,
    updateConversation
  ]);

  useEffect(() => {
    if (
      Platform.OS !== 'web' ||
      (!pendingGreetingAudioUri && !pendingGreetingSpeechText) ||
      typeof document === 'undefined'
    ) {
      return;
    }

    const handleFirstGesture = () => {
      const uri = pendingGreetingAudioUri;
      const speechText = pendingGreetingSpeechText;
      setPendingGreetingAudioUri(null);
      setPendingGreetingSpeechText(null);

      if (uri) {
        void playGreetingAudio(uri);
      }

      if (speechText) {
        clearGreetingGestureRetry();
        greetingGestureRetryTimeoutRef.current = setTimeout(() => {
          const audioState = audioStateRef.current;
          if (audioState.isPlaying || audioState.isLoading) {
            return;
          }
          if (speakGreetingWithWebFallback(speechText, language)) {
            pulseGreetingSpeechHint(estimateGreetingSpeechDurationMs(speechText));
          }
        }, 420);
      }
    };

    document.addEventListener('pointerdown', handleFirstGesture, { once: true });
    return () => {
      document.removeEventListener('pointerdown', handleFirstGesture);
      clearGreetingGestureRetry();
    };
  }, [clearGreetingGestureRetry, language, pendingGreetingAudioUri, pendingGreetingSpeechText, playGreetingAudio, pulseGreetingSpeechHint]);

  useEffect(() => {
    return () => {
      clearTypingInterval();
      clearGreetingPlaybackCheck();
      clearGreetingGestureRetry();
      clearGreetingSpeechHint();
    };
  }, [clearGreetingGestureRetry, clearGreetingPlaybackCheck, clearGreetingSpeechHint, clearTypingInterval]);

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
      {greeting ? (
        <View pointerEvents="none" style={[styles.greetingOverlay, { maxHeight: greetingOverlayMaxHeight }]}>
          <View style={styles.greetingBubbleStack}>
            {isGreetingVoiceActive ? (
              <View style={[styles.greetingVoiceIndicator, isGreetingVoicePendingGesture ? styles.greetingVoiceIndicatorBlocked : null]}>
                <View style={[styles.greetingVoiceDot, isGreetingVoicePendingGesture ? styles.greetingVoiceDotBlocked : null]} />
                <Text style={styles.greetingVoiceLabel}>{greetingVoiceLabel}</Text>
              </View>
            ) : null}
            {(greetingBubbles.length > 0 ? greetingBubbles : ['...']).map((bubble, index) => (
              <View key={`${index}-${bubble.slice(0, 16)}`} style={styles.greetingBubble}>
                <Text style={styles.greetingBubbleText}>{bubble}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
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
  greetingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: theme.spacing.sm,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: theme.spacing.md,
    overflow: 'hidden'
  },
  greetingBubbleStack: {
    width: '100%',
    maxWidth: 608,
    gap: theme.spacing.xs,
    alignItems: 'flex-start',
    justifyContent: 'flex-end'
  },
  greetingVoiceIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: 'rgba(10, 14, 24, 0.82)',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5
  },
  greetingVoiceIndicatorBlocked: {
    borderColor: theme.colors.accent
  },
  greetingVoiceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.neonBlue
  },
  greetingVoiceDotBlocked: {
    backgroundColor: theme.colors.accent
  },
  greetingVoiceLabel: {
    color: theme.colors.textPrimary,
    fontSize: 11,
    fontWeight: '700'
  },
  greetingBubble: {
    maxWidth: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: 'rgba(11, 16, 29, 0.86)',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs
  },
  greetingBubbleText: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600'
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
